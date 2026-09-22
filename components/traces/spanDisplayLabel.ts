/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Span } from '@/types';

/** Display-only fallback for older producers; never changes stored span names. */
export function getSpanDisplayLabel(span: Pick<Span, 'name' | 'attributes'>): { label: string; title: string } {
  const tool = span.attributes?.['gen_ai.tool.name'];
  // Exact bare tool name only: chat, roots, and authored names stay unchanged.
  const label = span.name === 'execute_tool' && typeof tool === 'string' && tool.trim()
    ? `${span.name} · ${tool.trim()}`
    : span.name;
  return { label, title: label };
}
