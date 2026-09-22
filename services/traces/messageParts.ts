/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

export interface DisplayMessagePart {
  type: string;
  content: string;
}
export interface StructuredMessage {
  role: string;
  parts: DisplayMessagePart[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const asText = (value: unknown): string => typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? '';

/** Modern OTel parts. Unknown types remain readable text, never dropped. */
export function parseStructuredMessages(raw: unknown): StructuredMessage[] {
  let value = raw;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { return []; }
  }
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).filter(message => Array.isArray(message.parts)).map(message => ({
    role: typeof message.role === 'string' ? message.role : 'assistant',
    parts: (message.parts as unknown[]).map(part => {
      if (!isRecord(part)) return { type: 'text', content: asText(part) };
      return {
        type: typeof part.type === 'string' ? part.type : 'text',
        content: asText(part.content ?? part.text ?? part),
      };
    }),
  }));
}
