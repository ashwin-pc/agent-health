/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto';
import { getBackendUrl } from '@/lib/portConfig';

type Attribute = { key: string; value: { stringValue: string } | { intValue: number } };
export type DerivedSpan = {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: number;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: Attribute[];
  status: { code: number; message?: string };
};

type TraceOptions = {
  sessionId: string;
  runId?: string;
  model?: string;
  timedOut?: boolean;
};

type RecordValue = Record<string, any>;
const object = (value: unknown): RecordValue => value && typeof value === 'object' ? value as RecordValue : {};
const hash = (value: string, length: number): string => createHash('sha256').update(value).digest('hex').slice(0, length);
const nanos = (ms: number): string => (BigInt(Math.trunc(ms)) * BigInt(1_000_000)).toString();
function time(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.isFinite(Number(value)) ? Number(value) : Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}
function attributes(values: Record<string, string | number | undefined>): Attribute[] {
  return Object.entries(values).filter(([, value]) => value !== undefined).map(([key, value]) => ({
    key, value: typeof value === 'number' ? { intValue: value } : { stringValue: value as string },
  }));
}

/** Reconstruct observed work, not native instrumentation. No wall-clock fallback:
 * the same harvested events always produce identical IDs and timestamps. */
export function piWebEventsToOtlp(rawEvents: unknown[], options: TraceOptions) {
  const events = rawEvents.map(object);
  const harvest = [...events].reverse().find(event => event.kind === 'GET /api/messages');
  const messages: RecordValue[] = Array.isArray(harvest?.data?.messages) ? harvest.data.messages.map(object) : [];
  const firstTime = time(events[0]?.timestamp, 0);
  const start = time(events.find(event => event.kind === 'POST /api/prompt')?.timestamp, time(messages[0]?.timestamp, firstTime));
  const end = Math.max(start, time(harvest?.timestamp, time(messages.at(-1)?.timestamp, start)));
  const traceId = hash(`pi-web:${options.sessionId}`, 32);
  const rootId = hash(`pi-web:${options.sessionId}:root`, 16);
  const common = {
    'session.id': options.sessionId,
    'gen_ai.conversation.id': options.runId || options.sessionId,
    'agent_health.run.id': options.runId,
    'agent_health.trace.source': 'connector-derived',
    // Transcript timestamps do not measure provider latency or tool runtime.
    'agent_health.trace.timing': 'transcript-bounds',
  };
  const spans: DerivedSpan[] = [];
  const add = (key: string, name: string, operation: string, from: number, to: number,
    extra: Record<string, string | number | undefined>, code = 1, error?: string) => {
    spans.push({
      traceId, spanId: key === 'root' ? rootId : hash(`pi-web:${options.sessionId}:${key}`, 16),
      ...(key === 'root' ? {} : { parentSpanId: rootId }), name, kind: operation === 'chat' ? 3 : 1,
      startTimeUnixNano: nanos(from), endTimeUnixNano: nanos(Math.max(from, to)),
      attributes: attributes({ ...common, 'gen_ai.operation.name': operation, ...extra }),
      status: { code, ...(error ? { message: error.slice(0, 500) } : {}) },
    });
  };
  add('root', 'invoke_agent pi-web', 'invoke_agent', start, end, { 'gen_ai.agent.name': 'pi-web' },
    options.timedOut ? 2 : 1, options.timedOut ? 'Session settlement timed out; transcript may be partial' : undefined);

  const matchedResults = new Set<number>();
  messages.forEach((message, index) => {
    if (message.role !== 'assistant') return;
    const raw = object(message.raw);
    const from = Math.max(start, time(message.timestamp ?? raw.timestamp, start));
    const nextTime = time(messages[index + 1]?.timestamp, end);
    const content = Array.isArray(raw.content) ? raw.content.map(object) : [];
    const rawCalls = content.filter(part => part.type === 'toolCall');
    const calls: RecordValue[] = rawCalls.length ? rawCalls : (message.toolCalls || []).map(object);
    const usage = object(raw.usage);
    const model = raw.model || options.model;
    // A stored assistant timestamp is a turn start. Its next transcript entry
    // bounds completion; without tool-start events the exact split is unknown.
    const chatEnd = calls.length ? time(calls[0].startedAt, nextTime) : nextTime;
    const failed = message.isError || raw.stopReason === 'error' || raw.stopReason === 'aborted';
    add(`message:${index}`, `chat ${model || 'pi-web'}`, 'chat', from, chatEnd, {
      'gen_ai.request.model': model,
      'gen_ai.system': raw.provider,
      'gen_ai.usage.input_tokens': typeof usage.input === 'number' ? usage.input : undefined,
      'gen_ai.usage.output_tokens': typeof usage.output === 'number' ? usage.output : undefined,
      'gen_ai.usage.cache_read.input_tokens': typeof usage.cacheRead === 'number' ? usage.cacheRead : undefined,
      'gen_ai.usage.cache_creation.input_tokens': typeof usage.cacheWrite === 'number' ? usage.cacheWrite : undefined,
    }, failed ? 2 : 1, failed ? String(raw.errorMessage || raw.stopReason || 'Assistant error') : undefined);

    calls.forEach((call, callIndex) => {
      const toolName = String(call.name || call.toolName || 'tool');
      const resultIndex = messages.findIndex((result, candidate) => candidate > index
        && !matchedResults.has(candidate) && result.role === 'toolResult'
        && (call.id ? (result.toolCallId || result.raw?.toolCallId) === call.id : result.toolName === toolName));
      const result = resultIndex < 0 ? undefined : messages[resultIndex];
      if (result) matchedResults.add(resultIndex);
      const toolStart = time(call.startedAt, from);
      let summary = '';
      try { summary = JSON.stringify(call.arguments || call.args || {}).slice(0, 500); } catch { /* malformed args */ }
      const isError = result?.isError || result?.raw?.isError;
      add(`message:${index}:tool:${callIndex}`, `execute_tool ${toolName}`, 'execute_tool', toolStart,
        time(result?.timestamp, toolStart), {
          'gen_ai.tool.name': toolName,
          'gen_ai.tool.call_id': call.id,
          'agent_health.tool.args_summary': summary,
          'agent_health.tool.result': result ? (isError ? 'error' : 'success') : 'missing',
        }, result ? (isError ? 2 : 1) : 0, isError ? String(result?.text || 'Tool error') : undefined);
    });
  });
  // Accommodate inconsistent transcript clocks without putting children outside
  // their root. No invented duration for missing tool results.
  for (const child of spans.slice(1)) {
    if (BigInt(child.startTimeUnixNano) < BigInt(spans[0].startTimeUnixNano)) spans[0].startTimeUnixNano = child.startTimeUnixNano;
    if (BigInt(child.endTimeUnixNano) > BigInt(spans[0].endTimeUnixNano)) spans[0].endTimeUnixNano = child.endTimeUnixNano;
  }
  return {
    resourceSpans: [{
      resource: { attributes: attributes({ 'service.name': 'pi-web' }) },
      scopeSpans: [{ scope: { name: 'agent-health-pi-web-connector' }, spans }],
    }],
  };
}

/** Await a bounded best-effort delivery before returning the harvest, so the
 * trace poller can find it immediately. Never send the pi-web auth token here. */
export async function deliverPiWebTraces(rawEvents: unknown[], options: TraceOptions, baseUrl = getBackendUrl()): Promise<void> {
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/v1/traces`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(piWebEventsToOtlp(rawEvents, options)), signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error(`OTLP receiver returned HTTP ${response.status}`);
    await response.text();
  } catch (error) {
    console.warn(`[pi-web connector] Trace delivery failed for ${options.sessionId}; keeping harvested result:`, error);
  }
}
