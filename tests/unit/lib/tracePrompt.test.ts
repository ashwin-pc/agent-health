/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */
import { getRootSpanPrompt, promptPreview, summarizeTracePrompts } from '@/lib/tracePrompt';
import type { Span } from '@/types';

it('prefers the legacy plain prompt, then the first user text part', () => {
  const messages = [{ role: 'system', parts: [{ type: 'text', content: 'private' }] }, { role: 'user', parts: [{ type: 'image' }, { type: 'text', content: 'Inspect services' }] }];
  expect(getRootSpanPrompt({ attributes: { 'gen_ai.prompt': 'plain', 'gen_ai.input.messages': messages } })).toBe('plain');
  expect(getRootSpanPrompt({ attributes: { 'gen_ai.input.messages': JSON.stringify(messages) } })).toBe('Inspect services');
  expect(getRootSpanPrompt({ attributes: { 'gen_ai.input.messages': messages } })).toBe('Inspect services');
});
it.each([undefined, '{}', 'bad json', [], [{ role: 'assistant', parts: [{ type: 'text', content: 'not the prompt' }] }]])('ignores absent or malformed prompts: %p', messages => {
  expect(getRootSpanPrompt({ attributes: { 'gen_ai.prompt': 42, 'gen_ai.input.messages': messages } })).toBe('');
});
it('bounds Unicode previews to 200 characters without changing full prompts', () => {
  expect(Array.from(promptPreview('😀'.repeat(300)))).toHaveLength(200);
  expect(promptPreview('x'.repeat(200))).toHaveLength(200);
  expect(promptPreview('x'.repeat(201))).toBe('x'.repeat(199) + '…');
});
it('uses only the root, never a child prompt, and leaves spans untouched', () => {
  const spans = [
    { traceId: 't1', spanId: 'child', parentSpanId: 'root', name: 'chat', attributes: { 'gen_ai.prompt': 'child context' } },
    { traceId: 't1', spanId: 'root', name: 'invoke_agent', attributes: { 'gen_ai.prompt': 'root prompt' } },
    { traceId: 't2', spanId: 'orphan', parentSpanId: 'missing', name: 'chat', attributes: { 'gen_ai.prompt': 'not a root' } },
  ] as Span[];
  const before = JSON.stringify(spans);
  expect(summarizeTracePrompts(spans)).toEqual([
    { traceId: 't1', rootSpanName: 'invoke_agent', prompt: 'root prompt' },
    { traceId: 't2', rootSpanName: 'chat', prompt: '' },
  ]);
  expect(JSON.stringify(spans)).toBe(before);
});
