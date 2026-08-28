/**
 * @jest-environment jsdom
 */

/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import * as React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CollapsibleTestCaseDefinition } from '@/components/evals3/CollapsibleTestCaseDefinition';
import { TestCase } from '@/types';

jest.mock('react-markdown', () => {
  return function MockReactMarkdown({ children }: { children: string }) {
    return React.createElement(
      'div',
      null,
      children.startsWith('**Authored**')
        ? React.createElement('strong', null, 'Authored')
        : children,
    );
  };
});

jest.mock('remark-gfm', () => () => {});

const testCase: TestCase = {
  id: 'tc-readable',
  name: 'Investigate checkout failures',
  description: 'Find the cause of a production checkout regression.',
  labels: ['category:RCA', 'difficulty:Hard', 'checkout'],
  category: 'Baseline',
  difficulty: 'Easy',
  currentVersion: 1,
  versions: [],
  isPromoted: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  initialPrompt: 'Why are checkout requests failing?',
  expectedOutcomes: [
    'Identify the payment-service timeout',
    'Recommend a safe mitigation',
  ],
  context: [
    {
      description: 'Cluster evidence',
      value: '{"service":"payment-service","error":"timeout"}',
    },
  ],
};

describe('CollapsibleTestCaseDefinition', () => {
  it('returns no card when the run has no test-case definition', () => {
    const { container } = render(
      React.createElement(CollapsibleTestCaseDefinition, { testCase: null }),
    );
    expect(container.firstChild).toBeNull();
  });

  it('toggles the readable definition and mounts raw JSON only after disclosure', () => {
    render(React.createElement(CollapsibleTestCaseDefinition, { testCase }));

    const definitionToggle = screen.getByRole('button', { name: /Test Case Definition/i });
    expect(definitionToggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('Why are checkout requests failing?')).toBeNull();

    fireEvent.click(definitionToggle);

    expect(definitionToggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Why are checkout requests failing?')).toBeTruthy();
    expect(screen.getByText('Identify the payment-service timeout')).toBeTruthy();
    expect(screen.getByText('Recommend a safe mitigation')).toBeTruthy();
    expect(screen.getByText('Cluster evidence')).toBeTruthy();
    expect(screen.getByText('RCA')).toBeTruthy();
    expect(screen.getByText('Hard')).toBeTruthy();
    expect(screen.queryByTestId('raw-test-case-json')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'View raw JSON' }));

    const raw = screen.getByTestId('raw-test-case-json');
    expect(raw.textContent).toContain('"initialPrompt": "Why are checkout requests failing?"');
    expect(screen.getByRole('button', { name: 'Hide raw JSON' }).getAttribute('aria-expanded')).toBe('true');

    fireEvent.click(definitionToggle);
    expect(definitionToggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('raw-test-case-json')).toBeNull();
  });

  it('shows SDK provenance and copies the source path', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const sdkCase = {
      ...testCase,
      sourceFile: 'examples/eval-files/demo.eval.ts',
      sourceHash: '1234567890abcdefextra',
    } as TestCase;

    render(React.createElement(CollapsibleTestCaseDefinition, {
      testCase: sdkCase,
      defaultOpen: true,
      className: 'sdk-definition',
    }));

    expect(screen.getByText('SDK')).toBeTruthy();
    expect(screen.getByText('examples/eval-files/demo.eval.ts')).toBeTruthy();
    expect(screen.getByText('sha256: 1234567890abcdef…')).toBeTruthy();

    fireEvent.click(screen.getByTitle('Copy path'));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('examples/eval-files/demo.eval.ts'));
  });
});

describe('TestCaseDefinition — SDK / code-authored cases', () => {
  const { TestCaseDefinition } = require('@/components/TestCaseDefinition');
  const sourceOnlyCase: TestCase = {
    ...testCase,
    id: 'tc-sdk-source-only',
    name: 'sdk registered test',
    description: '',
    labels: [],
    category: undefined as any,
    difficulty: undefined as any,
    initialPrompt: '',
    expectedOutcomes: [],
    context: [],
    sourceFile: 'examples/eval-files/demo.eval.ts',
  };

  it('renders only the source pointer when no declarative fields exist', () => {
    render(React.createElement(TestCaseDefinition, { testCase: sourceOnlyCase }));
    expect(screen.getByText('examples/eval-files/demo.eval.ts')).toBeTruthy();
    expect(screen.getByText(/isn't serializable from runtime state/)).toBeTruthy();
    expect(screen.queryByTestId('readable-test-case-definition')).toBeNull();
    expect(screen.queryByText('Input')).toBeNull();
  });

  it('renders the source pointer and every populated declarative field for mixed SDK cases', () => {
    render(React.createElement(TestCaseDefinition, { testCase: {
      ...testCase,
      sourceFile: 'examples/eval-files/mixed.eval.ts',
    } }));
    expect(screen.getByText('examples/eval-files/mixed.eval.ts')).toBeTruthy();
    expect(screen.getByText(testCase.initialPrompt!)).toBeTruthy();
    expect(screen.getByText('Identify the payment-service timeout')).toBeTruthy();
    expect(screen.getByText('Cluster evidence')).toBeTruthy();
  });

  it('still renders the declarative rubric for JSON cases', () => {
    render(React.createElement(TestCaseDefinition, { testCase }));
    expect(screen.getByText('Why are checkout requests failing?')).toBeTruthy();
    expect(screen.getByText('Identify the payment-service timeout')).toBeTruthy();
  });

  it('groups context by delivery disposition and renders documentation as markdown', () => {
    render(React.createElement(TestCaseDefinition, { testCase: {
      ...testCase,
      context: [
        { description: 'legacy', value: 'plain' },
        { description: 'fixture', value: '/tmp/workspace', disposition: 'connector' },
        { description: 'guide', value: '**Authored** documentation', disposition: 'documentation' },
      ],
    } }));

    expect(screen.getByTestId('context-delivery-summary').textContent)
      .toContain('prompt + 1 context items · directives: 1 · documentation: 1');
    expect(screen.getByText('Delivered to agent')).toBeTruthy();
    expect(screen.getByText('Connector directive — not delivered')).toBeTruthy();
    expect(screen.getByText('Documentation — not delivered')).toBeTruthy();
    expect(screen.getByText('Authored').tagName).toBe('STRONG');
  });

  it('uses canonical, case-sensitive label parsing for chips', () => {
    render(React.createElement(TestCaseDefinition, { testCase: {
      ...testCase,
      category: undefined,
      difficulty: undefined,
      labels: ['category:RCA', 'difficulty:Hard', 'subcategory:network', 'Category:NotCanonical', 'difficulty:Impossible'],
    } }));
    for (const chip of ['RCA', 'Hard', 'network', 'Category:NotCanonical']) {
      expect(screen.getByText(chip)).toBeTruthy();
    }
    expect(screen.queryByText('difficulty:Impossible')).toBeNull();
  });
});
