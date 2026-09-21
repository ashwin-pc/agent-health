/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */
import { deliverPiWebTraces, piWebEventsToOtlp } from './traces';

const start = 1_700_000_000_000;
const fixture = [
  { kind: 'POST /api/prompt', timestamp: String(start), data: {} },
  { kind: 'GET /api/messages', timestamp: new Date(start + 5000).toISOString(), data: { messages: [
    { role: 'user', timestamp: start, text: 'write a file' },
    { role: 'assistant', timestamp: String(start + 100), toolCalls: [{ id: 'call-1', toolName: 'write' }], raw: {
      model: 'claude-sonnet', provider: 'amazon-bedrock', usage: { input: 12, output: 30, cacheRead: 100 },
      content: [{ type: 'toolCall', id: 'call-1', name: 'write', startedAt: start + 400,
        arguments: { path: 'output.txt', content: 'x'.repeat(1000) } }],
    } },
    { role: 'toolResult', toolCallId: 'call-1', toolName: 'write', timestamp: start + 600, isError: true, text: 'denied' },
    { role: 'assistant', timestamp: new Date(start + 700).toISOString(), toolCalls: [{ id: 'call-2', toolName: 'read', args: { path: 'output.txt' } }] },
    { role: 'toolResult', toolCallId: 'call-2', toolName: 'read', timestamp: start + 900, text: 'ok' },
    { role: 'assistant', timestamp: start + 1000, text: 'done' },
  ] } },
];
const attrs = (span: any) => Object.fromEntries(span.attributes.map((a: any) => [a.key, a.value.stringValue ?? a.value.intValue]));
const options = { sessionId: 'session-123', runId: 'run-456', model: 'fallback' };

afterEach(() => jest.restoreAllMocks());

it('builds a deterministic root, model turns and deduplicated tool calls from harvested events', () => {
  const payload = piWebEventsToOtlp(fixture, options);
  expect(payload).toEqual(piWebEventsToOtlp(fixture, options));
  expect(payload.resourceSpans[0].resource.attributes).toContainEqual({ key: 'service.name', value: { stringValue: 'pi-web' } });
  const spans = payload.resourceSpans[0].scopeSpans[0].spans;
  expect(spans).toHaveLength(6);
  expect(new Set(spans.map(s => s.spanId)).size).toBe(6);
  expect(new Set(spans.map(s => s.traceId)).size).toBe(1);
  expect(spans[0].parentSpanId).toBeUndefined();
  for (const span of spans) {
    expect(span.traceId).toMatch(/^[a-f0-9]{32}$/);
    expect(span.spanId).toMatch(/^[a-f0-9]{16}$/);
    expect(attrs(span)).toMatchObject({ 'gen_ai.conversation.id': 'run-456', 'agent_health.run.id': 'run-456',
      'session.id': 'session-123', 'agent_health.trace.source': 'connector-derived' });
    if (span !== spans[0]) expect(span.parentSpanId).toBe(spans[0].spanId);
  }
  expect(attrs(spans[1])).toMatchObject({ 'gen_ai.operation.name': 'chat', 'gen_ai.request.model': 'claude-sonnet',
    'gen_ai.usage.input_tokens': 12, 'gen_ai.usage.output_tokens': 30 });
  expect(attrs(spans[2])['agent_health.tool.args_summary']).toHaveLength(500);
  expect(spans[2].status).toEqual({ code: 2, message: 'denied' });
  expect(spans[2].startTimeUnixNano).toBe('1700000000400000000');
  expect(spans[2].endTimeUnixNano).toBe('1700000000600000000');
  expect(spans[4].status.code).toBe(1);
});

it('falls back to session correlation and marks missing results and timed-out runs honestly', () => {
  const events = [{ kind: 'GET /api/messages', timestamp: start, data: { messages: [
    { role: 'assistant', timestamp: 'invalid', toolCalls: [{ toolName: 'edit' }] },
  ] } }];
  const spans = piWebEventsToOtlp(events, { sessionId: 'fallback', timedOut: true }).resourceSpans[0].scopeSpans[0].spans;
  expect(attrs(spans[0])['gen_ai.conversation.id']).toBe('fallback');
  expect(attrs(spans[0])['agent_health.run.id']).toBeUndefined();
  expect(spans[0].status.code).toBe(2);
  expect(spans[2].status.code).toBe(0);
  expect(attrs(spans[2])['agent_health.tool.result']).toBe('missing');
  expect(spans[2].startTimeUnixNano).toBe(spans[2].endTimeUnixNano);
});

it('posts OTLP to the receiver without pi-web credentials and tolerates delivery failure', async () => {
  const fetcher = jest.spyOn(global, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
  await deliverPiWebTraces(fixture, options, 'http://localhost:4321/');
  expect(fetcher).toHaveBeenCalledWith('http://localhost:4321/v1/traces', expect.objectContaining({
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(piWebEventsToOtlp(fixture, options)),
  }));
  const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
  fetcher.mockResolvedValueOnce(new Response('', { status: 500 }));
  await expect(deliverPiWebTraces(fixture, options)).resolves.toBeUndefined();
  fetcher.mockRejectedValueOnce(new Error('network offline'));
  await expect(deliverPiWebTraces(fixture, options)).resolves.toBeUndefined();
  expect(warning).toHaveBeenCalledTimes(2);
});
