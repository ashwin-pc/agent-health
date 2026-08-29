/**
 * @jest-environment jsdom
 */

/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describeFixturePayload, TestCaseDetailPanel } from '@/components/TestCaseDetailPanel';
import type { TestCase } from '@/types';

jest.mock('react-markdown', () => {
  return function MockReactMarkdown({ children }: { children: string }) {
    const [heading, ...body] = children.split(/\n+/).filter(Boolean);
    const bodyText = body.join(' ');
    const bold = /\*\*([^*]+)\*\*/.exec(bodyText);
    return React.createElement(
      React.Fragment,
      null,
      heading.startsWith('# ') ? React.createElement('h1', null, heading.slice(2)) : React.createElement('p', null, heading),
      bodyText && React.createElement(
        'p',
        null,
        bold ? bodyText.slice(0, bold.index) : bodyText,
        bold && React.createElement('strong', null, bold[1]),
        bold ? bodyText.slice((bold.index || 0) + bold[0].length) : null,
      ),
    );
  };
});

jest.mock('remark-gfm', () => () => {});

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
  it('detects authored manifest fields without guessing at unknown payload shapes', () => {
    const manifest = describeFixturePayload({
      manifest: {
        authoredNotes: '# Prepared workspace\n\nInspect this as reviewer context.',
        tree: [{ path: 'src/cache.ts', size: 1536, sha256: 'abcdef1234567890' }],
      },
    });

    expect(manifest).toMatchObject({
      isManifest: true,
      authoredNotes: '# Prepared workspace\n\nInspect this as reviewer context.',
      tree: [{ path: 'src/cache.ts', size: 1536, sha256: 'abcdef1234567890' }],
    });
    expect(manifest.rawJson).toContain('\n    "authoredNotes"');

    const unknown = describeFixturePayload({ files: [{ path: 'src/cache.ts' }] });
    expect(unknown).toMatchObject({ isManifest: false, authoredNotes: undefined, tree: undefined });
    expect(unknown.rawJson).toBe('{\n  "files": [\n    {\n      "path": "src/cache.ts"\n    }\n  ]\n}');
  });

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
    expect(screen.getByText('Raw JSON').closest('details')?.hasAttribute('open')).toBe(false);
    expect(fixture.textContent).toContain('src/cache.ts');
  });

  it('renders authored notes as markdown and the manifest tree as a compact table', () => {
    const sha256 = 'abcdef1234567890abcdef1234567890';
    render(React.createElement(TestCaseDetailPanel, { testCase: makeTestCase({
      fixture: {
        type: 'filesystem-workspace',
        ref: 'cache-refactor',
        integrity: 'sha256:abc123',
        payload: {
          manifest: {
            authoredNotes: '# Cache refactor fixture\n\nReview **policy boundaries** before implementation.',
            tree: [{ path: 'src/cache.ts', size: 1536, sha256 }],
          },
        },
      },
    }) }));

    expect(screen.getByText('For reviewers and audit — not delivered to the agent, not read by the judge.')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Cache refactor fixture' })).toBeTruthy();
    expect(screen.getByText('policy boundaries').tagName).toBe('STRONG');
    expect(screen.getByRole('table', { name: 'Fixture file tree' })).toBeTruthy();
    expect(screen.getByText('src/cache.ts')).toBeTruthy();
    expect(screen.getByText('1.5 KB')).toBeTruthy();
    expect(screen.getByTitle(sha256).textContent).toBe('abcdef123456');
    expect(screen.getByText('Raw JSON')).toBeTruthy();
  });

  it('does not render fixture UI for backward-compatible cases without the field', () => {
    render(React.createElement(TestCaseDetailPanel, { testCase: makeTestCase() }));

    expect(screen.queryByTestId('workspace-fixture')).toBeNull();
  });
});
