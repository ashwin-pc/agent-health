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
