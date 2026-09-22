/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Span, TraceListSummary } from '../types/index.js';

/** Root prompt only; never substitute a child chat's model context. */
export function getRootSpanPrompt(root?: Pick<Span, 'attributes'>): string {
  const attrs = root?.attributes;
  const legacy = attrs?.['gen_ai.prompt'];
  if (typeof legacy === 'string' && legacy.trim()) return legacy;
  let messages: unknown = attrs?.['gen_ai.input.messages'];
  if (typeof messages === 'string') {
    try { messages = JSON.parse(messages); } catch { return ''; }
  }
  if (!Array.isArray(messages)) return '';
  for (const message of messages) {
    if (!message || message.role !== 'user' || !Array.isArray(message.parts)) continue;
    const text = message.parts.find((part: unknown) =>
      part && typeof part === 'object' && 'type' in part && part.type === 'text'
      && 'content' in part && typeof part.content === 'string');
    if (text) return text.content;
  }
  return '';
}

export function promptPreview(prompt: string): string {
  const chars = Array.from(prompt);
  return chars.length > 200 ? chars.slice(0, 199).join('') + '…' : prompt;
}

/** Shared API metadata for both observability backends; raw spans stay intact. */
export function summarizeTracePrompts(spans: Span[]): TraceListSummary[] {
  const groups = new Map<string, Span[]>();
  for (const span of spans) {
    const group = groups.get(span.traceId) || [];
    group.push(span);
    groups.set(span.traceId, group);
  }
  return [...groups].map(([traceId, group]) => {
    const root = group.find(span => !span.parentSpanId);
    return { traceId, rootSpanName: root?.name || group[0].name, prompt: promptPreview(getRootSpanPrompt(root)) };
  });
}
