/** @jest-environment jsdom */
/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import type { Span, TimeRange } from '@/types';
import TraceTreeTable from '@/components/traces/TraceTreeTable';
import TraceTimelineChart from '@/components/traces/TraceTimelineChart';
import { SpanNode } from '@/components/traces/flow/SpanNode';
import { categorizeSpan } from '@/services/traces/spanCategorization';

const mockSetOption = jest.fn();
jest.mock('echarts', () => ({
  init: () => ({ setOption: mockSetOption, on: jest.fn(), off: jest.fn(), resize: jest.fn(), dispose: jest.fn() }),
  format: { encodeHTML: (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') },
}));

const timeRange: TimeRange = { startTime: 0, endTime: 1000, duration: 1000 };
const span = (name: string, attributes: Span['attributes'] = {}): Span => ({
  traceId: 'trace', spanId: name, name,
  attributes: { 'gen_ai.operation.name': name.split(/[ :]/)[0], ...attributes },
  startTime: '1970-01-01T00:00:00.000Z', endTime: '1970-01-01T00:00:01.000Z', status: 'OK',
});
const fixtures = [
  span('execute_tool', { 'gen_ai.tool.name': 'bash' }),
  span('execute_tool read', { 'gen_ai.tool.name': 'read' }),
  span('chat', { 'gen_ai.request.model': 'amazon-bedrock/us.anthropic.claude-sonnet-4.5-20250929-long-version:0' }),
  span('chat provider/model', { 'gen_ai.request.model': 'provider/model' }),
  span('invoke_agent', { 'gen_ai.agent.name': 'pi' }),
  span('invoke_agent: List files', { 'gen_ai.agent.name': 'pi' }),
  span('custom', { 'gen_ai.tool.name': 'read' }),
];

it.each([false, true])('tree labels enrich bare names only (timeline column=%s)', (withTimeline) => {
  const onSelect = jest.fn();
  const before = JSON.stringify(fixtures);
  const view = render(React.createElement(TraceTreeTable, {
    spanTree: fixtures, selectedSpan: null, onSelect,
    expandedSpans: new Set<string>(), onToggleExpand: jest.fn(),
    ...(withTimeline && { timeRange }),
  }));
  expect(view.getByText('execute_tool · bash').title).toBe('execute_tool · bash');
  expect(view.getByText('execute_tool read').title).toBe('execute_tool read');
  expect(view.getByText('chat').title).toBe('chat');
  expect(view.getByText('chat provider/model').title).toBe('chat provider/model');
  expect(view.getByText('invoke_agent')).toBeTruthy();
  expect(view.getByText('invoke_agent: List files')).toBeTruthy();
  expect(view.getByText('custom')).toBeTruthy();
  fireEvent.click(view.getByText('execute_tool · bash'));
  expect(onSelect).toHaveBeenCalledWith(expect.objectContaining(fixtures[0]));
  expect(JSON.stringify(fixtures)).toBe(before);
});

it('flow labels enrich bare tools and keep chat plain, preserving other display labels', () => {
  const view = render(React.createElement(React.Fragment, null, ...fixtures.map((s) =>
    React.createElement(SpanNode, { key: s.spanId, data: { span: categorizeSpan(s), totalDuration: 1000 } })
  )));
  expect(view.getByText('execute_tool · bash').title).toBe('execute_tool · bash');
  expect(view.getByText('chat').title).toBe('chat');
  expect(view.getByText('execute_tool read').title).toBe('execute_tool read');
  expect(view.getByText('invoke_agent').title).toBe('invoke_agent');
  expect(view.getByText('chat provider/model').title).toBe('chat provider/model');
  expect(view.getByText('invoke_agent: List files').title).toBe('invoke_agent: List files');
  expect(view.getByText('custom').title).toBe('custom');
});

it.each([undefined, '', '  ', 42, { name: 'bash' }])('keeps bare names when metadata is missing or invalid: %p', (detail) => {
  const view = render(React.createElement(TraceTreeTable, {
    spanTree: [span('execute_tool', { 'gen_ai.tool.name': detail })], selectedSpan: null,
    onSelect: jest.fn(), expandedSpans: new Set<string>(), onToggleExpand: jest.fn(),
  }));
  expect(view.getByText('execute_tool').title).toBe('execute_tool');
});

it('timeline decorates only bare tools, keeps chat plain, and escapes tooltip details', () => {
  render(React.createElement(TraceTimelineChart, {
    spanTree: [fixtures[0], fixtures[1], span('chat', { 'gen_ai.request.model': 'anthropic/claude-sonnet-4.5' }), span('execute_tool', { 'gen_ai.tool.name': '<b>bash</b>' })],
    timeRange, selectedSpan: null, onSelectSpan: jest.fn(), expandedSpans: new Set<string>(), onToggleExpand: jest.fn(),
  }));
  const option = mockSetOption.mock.calls.at(-1)![0];
  expect(option.yAxis.axisLabel.formatter(0)).toContain('execute_tool · bash');
  expect(option.yAxis.axisLabel.formatter(1)).toContain('execute_tool read');
  expect(option.yAxis.axisLabel.formatter(2).trim()).toBe('chat');
  expect(option.tooltip.formatter({ data: option.series[0].data[2] })).toContain('>chat</div>');
  expect(option.tooltip.formatter({ data: option.series[0].data[2] })).not.toContain('claude');
  expect(option.tooltip.formatter({ data: option.series[0].data[3] })).toContain('execute_tool · &lt;b&gt;bash&lt;/b&gt;');
});
