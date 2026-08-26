/**
 * @jest-environment jsdom
 */

/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import * as React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { CollapsibleTestCaseDefinition } from '@/components/evals3/CollapsibleTestCaseDefinition';
import { TestCase } from '@/types';

jest.mock('react-markdown', () => {
  return function MockReactMarkdown({ children }: { children: string }) {
    return React.createElement('div', null, children);
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
  it('leads with readable fields and mounts raw JSON only after disclosure', () => {
    render(
      React.createElement(CollapsibleTestCaseDefinition, {
        testCase,
        defaultOpen: true,
      }),
    );

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
  });
});
