/**
 * @jest-environment jsdom
 */

/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { TestCaseDetailPanel } from '@/components/TestCaseDetailPanel';
import type { TestCase } from '@/types';

jest.mock('@/components/ui/markdown', () => ({
  Markdown: ({ children }: { children: string }) => React.createElement(
    'div',
    null,
    children.startsWith('**Authored**')
      ? React.createElement('strong', null, 'Authored')
      : children,
  ),
}));

const testCase = {
  id: 'tc',
  name: 'Disposition test',
  description: 'Verify context delivery',
  labels: ['category:test'],
  category: 'test',
  difficulty: 'Easy',
  currentVersion: 1,
  versions: [],
  isPromoted: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  initialPrompt: 'Go',
  expectedOutcomes: ['Done'],
  context: [
    { description: 'legacy', value: 'plain' },
    { description: 'directive', value: '/tmp/fixture', disposition: 'connector' },
    { description: 'manifest', value: '**Authored** documentation', disposition: 'documentation' },
  ],
} as TestCase;

describe('TestCaseDetailPanel context dispositions', () => {
  it('uses the shared grouping, delivery summary, and documentation markdown', () => {
    render(React.createElement(TestCaseDetailPanel, { testCase }));

    expect(screen.getByTestId('context-delivery-summary').textContent)
      .toContain('prompt + 1 context items · directives: 1 · documentation: 1');
    expect(screen.getByText('Delivered to agent')).toBeTruthy();
    expect(screen.getByText('Connector directive — not delivered')).toBeTruthy();
    expect(screen.getByText('Documentation — not delivered')).toBeTruthy();
    expect(screen.getByText('Authored').tagName).toBe('STRONG');
  });
});
