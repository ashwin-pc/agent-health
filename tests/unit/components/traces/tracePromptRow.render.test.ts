/** @jest-environment jsdom */
/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react';
import { TraceRow, TraceTableRow } from '@/components/traces/AgentTracesPage';

jest.mock('echarts', () => ({ init: jest.fn() }));
const base: TraceTableRow = { traceId: '1234567890abcdef', rootSpanName: 'invoke_agent', serviceName: 'pi-web', startTime: new Date(), duration: 1000, spanCount: 4, hasErrors: false, spans: [] };
function row(overrides: Partial<TraceTableRow> = {}) {
  return render(React.createElement('table', null, React.createElement('tbody', null,
    React.createElement(TraceRow, { trace: { ...base, ...overrides }, onSelect: jest.fn(), isSelected: false, isExpanded: false }))));
}
it('shows the prompt preview with full title, plus the root name and copyable trace id', async () => {
  const writeText = jest.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  const view = row({ prompt: 'Inspect services', promptTitle: 'Inspect services and summarize each file' });
  expect(view.getByText('Inspect services').title).toBe('Inspect services and summarize each file');
  expect(view.getByText('invoke_agent')).toBeTruthy();
  expect(view.getByText('12345678…').title).toBe(base.traceId);
  fireEvent.click(view.getByRole('button', { name: 'Copy trace ID' }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(base.traceId));
});
it('renders a blank prompt cell for legacy traces without prompt metadata', () => {
  const view = row();
  expect(view.getByTestId('trace-prompt-cell').textContent).toBe('');
  expect(view.getByText('invoke_agent')).toBeTruthy();
  expect(view.getByText('12345678…')).toBeTruthy();
});
