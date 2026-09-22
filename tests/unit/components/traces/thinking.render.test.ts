/** @jest-environment jsdom */
/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import * as React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import FormattedMessages from '@/components/traces/FormattedMessages';
import MessageHistoryView from '@/components/traces/MessageHistoryView';
import SpanInputOutput from '@/components/traces/SpanInputOutput';
import { ThinkingStateProvider } from '@/components/traces/ThinkingBlock';
import { extractMessagesFromSpans } from '@/services/traces/messageExtraction';
import { Span } from '@/types';

const thinking = 'Compare exponential backoff with linear delays.';
const parts = [
  { type: 'text', content: 'Before thinking' },
  { type: 'reasoning', content: thinking },
  { type: 'vendor-part', content: 'Unknown still readable' },
  { type: 'text', content: 'Use jitter.' },
];
const messages = JSON.stringify([{ role: 'assistant', parts }]);
const span: Span = {
  traceId: 'trace-thinking', spanId: 'chat-thinking', name: 'chat',
  startTime: '2026-09-17T09:00:00Z', endTime: '2026-09-17T09:00:01Z', duration: 1000, status: 'OK',
  attributes: { 'gen_ai.operation.name': 'chat', 'gen_ai.output.messages': messages, 'agent_health.trace.source': 'native-extension' },
};

it('formats ordered reasoning collapsed by default and keeps unknown parts as text', () => {
  const { container } = render(React.createElement(FormattedMessages, { messages }));
  const button = screen.getByRole('button', { name: `Thinking Show ${thinking.length} chars` });
  expect(button.getAttribute('aria-expanded')).toBe('false');
  expect(screen.queryByText(thinking)).toBeNull();
  expect(screen.getByText('Unknown still readable')).toBeTruthy();
  fireEvent.click(button);
  expect(button.getAttribute('aria-expanded')).toBe('true');
  expect(screen.getByText(thinking)).toBeTruthy();
  expect(container.textContent!.indexOf('Before thinking')).toBeLessThan(container.textContent!.indexOf(thinking));
  expect(container.textContent!.indexOf(thinking)).toBeLessThan(container.textContent!.indexOf('Use jitter.'));
});

it('explains an empty provider reasoning block without inventing thinking text', () => {
  render(React.createElement(FormattedMessages, { messages: [{ role: 'assistant', parts: [{ type: 'reasoning', content: '' }] }] }));
  fireEvent.click(screen.getByRole('button', { name: 'Thinking Show 0 chars' }));
  expect(screen.getByText('No thinking text was emitted by the model.')).toBeTruthy();
});

it('keeps text-only and unknown legacy block renderings unchanged', () => {
  render(React.createElement(FormattedMessages, { messages: [{ role: 'assistant', content: [{ type: 'text', text: 'Legacy answer' }, { type: 'unknown', value: 'payload' }] }] }));
  expect(screen.getByText('Legacy answer')).toBeTruthy();
  expect(screen.getByText(/payload/)).toBeTruthy();
  expect(screen.queryByText('Thinking')).toBeNull();
});

it('shows modern parts in Messages and retains per-span expansion when the tab remounts', () => {
  const view = (spans: Span[]) => React.createElement(ThinkingStateProvider, null,
    spans.length ? React.createElement(MessageHistoryView, { spans }) : null);
  const { rerender } = render(view([span]));
  expect(screen.queryByText(thinking)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /Thinking Show/ }));
  rerender(view([]));
  rerender(view([{ ...span, spanId: 'other-chat' }]));
  expect(screen.queryByText(thinking)).toBeNull();
  rerender(view([span]));
  expect(screen.getByText(thinking)).toBeTruthy();
});

it('renders reasoning disclosures in SpanInputOutput, retaining state after card collapse', () => {
  render(React.createElement(SpanInputOutput, { spans: [span] }));
  fireEvent.click(screen.getByText('chat'));
  expect(screen.queryByText(thinking)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /Thinking Show/ }));
  expect(screen.getByText(thinking)).toBeTruthy();
  fireEvent.click(screen.getByText('chat'));
  fireEvent.click(screen.getByText('chat'));
  expect(screen.getByText(thinking)).toBeTruthy();
});

it('legacy text-only span stays readable without Thinking', () => {
  render(React.createElement(MessageHistoryView, { spans: [{ ...span, attributes: { 'gen_ai.completion': 'Legacy completion' } }] }));
  expect(screen.getByText('Legacy completion')).toBeTruthy();
  expect(screen.queryByText('Thinking')).toBeNull();
});

it('keeps a longer root answer when the chat capture was truncated more tightly', () => {
  const root = { ...span, spanId: 'root', name: 'invoke_agent', attributes: {
    'agent_health.trace.source': 'native-extension', 'gen_ai.operation.name': 'invoke_agent',
    'gen_ai.completion': 'A longer complete final answer.',
  } };
  const extracted = extractMessagesFromSpans([root, span]);
  expect(extracted.some(message => message.content === 'A longer complete final answer.')).toBe(true);
});

it('extracts native chat output without duplicating root or legacy completion aliases', () => {
  const root = { ...span, spanId: 'root', name: 'invoke_agent', attributes: {
    'agent_health.trace.source': 'native-extension', 'gen_ai.operation.name': 'invoke_agent',
    'gen_ai.prompt': 'Question', 'gen_ai.completion': 'Use jitter.', 'gen_ai.output.messages': messages,
  } };
  const extracted = extractMessagesFromSpans([root, { ...span, attributes: { ...span.attributes, 'gen_ai.completion': 'Use jitter.' } }]);
  expect(extracted).toHaveLength(2);
  expect(extracted[0].content).toBe('Question');
  expect(extracted[1].parts).toEqual(parts);
  expect(extracted[1].content).not.toContain(thinking);
});
