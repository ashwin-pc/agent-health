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

const dispositionTestCase = {
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

function makeTestCase(overrides: Partial<TestCase> = {}): TestCase {
  return {
    id: 'tc-fixture',
    name: 'Fixture case',
    description: 'Investigate the prepared workspace',
    labels: [],
    category: 'RCA',
    difficulty: 'Medium',
    currentVersion: 1,
    versions: [],
    isPromoted: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    initialPrompt: 'Find the root cause',
    context: [],
    ...overrides,
  };
}

describe('TestCaseDetailPanel context dispositions', () => {
  it('uses the shared grouping, delivery summary, and documentation markdown', () => {
    render(React.createElement(TestCaseDetailPanel, { testCase: dispositionTestCase }));

    expect(screen.getByTestId('context-delivery-summary').textContent)
      .toContain('prompt + 1 context items · directives: 1 · documentation: 1');
    expect(screen.getByText('Delivered to agent')).toBeTruthy();
    expect(screen.getByText('Connector directive — not delivered')).toBeTruthy();
    expect(screen.getByText('Documentation — not delivered')).toBeTruthy();
    expect(screen.getByText('Authored').tagName).toBe('STRONG');
  });
});

describe('TestCaseDetailPanel fixture rendering', () => {
  it('renders a fixture as first-class non-delivered scenario context with collapsible payload', () => {
    render(React.createElement(TestCaseDetailPanel, { testCase: makeTestCase({
      fixture: {
        type: 'filesystem-workspace',
        ref: 'cache-refactor',
        integrity: 'sha256:abc123',
        payload: { files: [{ path: 'src/cache.ts' }] },
      },
    }) }));

    const fixture = screen.getByTestId('workspace-fixture');
    expect(fixture.textContent).toContain('Workspace fixture');
    expect(fixture.textContent).toContain(
      'cache-refactor — integrity-pinned (filesystem-workspace), not disclosed to the agent',
    );
    expect(screen.getByText('Fixture payload').closest('details')?.hasAttribute('open')).toBe(false);
    expect(fixture.textContent).toContain('src/cache.ts');
  });

  it('does not render fixture UI for backward-compatible cases without the field', () => {
    render(React.createElement(TestCaseDetailPanel, { testCase: makeTestCase() }));

    expect(screen.queryByTestId('workspace-fixture')).toBeNull();
  });
});
