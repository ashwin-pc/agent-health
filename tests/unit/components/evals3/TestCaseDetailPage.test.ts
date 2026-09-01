/**
 * @jest-environment jsdom
 */

/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import * as React from 'react';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';

const mockNavigate = jest.fn();
const mockGetTestCase = jest.fn();
const mockGetReports = jest.fn();
const mockSetSidebarCollapsed = jest.fn();

jest.mock('react-markdown', () => ({
  __esModule: true,
  default: ({ children }: { children: string }) => React.createElement('div', null, children),
}));
jest.mock('remark-gfm', () => () => {});

jest.mock('react-router-dom', () => ({
  useParams: () => ({ testCaseId: 'tc-hero' }),
  useNavigate: () => mockNavigate,
}));

jest.mock('@/services/storage', () => ({
  asyncTestCaseStorage: {
    getById: (...args: unknown[]) => mockGetTestCase(...args),
  },
  asyncRunStorage: {
    getReportsByTestCase: (...args: unknown[]) => mockGetReports(...args),
  },
}));

jest.mock('@/components/Layout', () => ({
  useSidebarCollapse: () => ({ isCollapsed: false, setIsCollapsed: mockSetSidebarCollapsed }),
}));

jest.mock('@/hooks/use-mobile', () => ({
  useIsMobile: () => false,
}));

jest.mock('@/components/evals3/Breadcrumbs', () => ({
  Breadcrumbs: ({ actions }: { actions?: React.ReactNode }) => React.createElement('nav', null, actions),
}));

jest.mock('@/components/evals3/TestCaseInspectorPanel', () => ({
  TestCaseInspectorPanel: () => React.createElement('div', { 'data-testid': 'run-inspector' }, 'Run inspector'),
}));

jest.mock('@/components/ui/scroll-area', () => ({
  ScrollArea: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
}));

jest.mock('@/components/ui/resizable', () => ({
  ResizablePanelGroup: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
  ResizablePanel: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
  ResizableHandle: () => React.createElement('div'),
}));

jest.mock('@/services/client/evaluationApi', () => ({
  runServerEvaluation: jest.fn(),
}));

jest.mock('@/lib/constants', () => ({
  DEFAULT_CONFIG: { agents: [], models: {} },
  getPreferredDefaultAgentKey: () => '',
}));

jest.mock('@/lib/config', () => ({
  ENV_CONFIG: { backendUrl: '' },
}));

jest.mock('@/lib/utils', () => {
  const actual = jest.requireActual('@/lib/utils');
  return {
    ...actual,
    formatDate: () => 'Jan 2, 2025',
    formatRelativeTime: () => 'recently',
    getModelName: (value: string) => value || '—',
    getRunDisplayName: (run: { name?: string }) => run.name || 'Unnamed run',
  };
});

import { TestCaseDetailPage } from '@/components/evals3/TestCaseDetailPage';

const testCase = {
  id: 'tc-hero',
  name: 'Autonomy calibration',
  description: 'Checks whether the agent discusses a vague request before making changes.',
  labels: ['category:Behavior', 'difficulty:Hard', 'design-first'],
  category: 'Behavior',
  difficulty: 'Hard',
  currentVersion: 2,
  versions: [
    { version: 1, createdAt: '2025-01-01T00:00:00Z', context: [], expectedOutcomes: ['Ask first'] },
    { version: 2, createdAt: '2025-01-02T00:00:00Z', context: [], expectedOutcomes: ['Discuss alternatives'] },
  ],
  isPromoted: false,
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-02T00:00:00Z',
  initialPrompt: 'The cache invalidation logic in this codebase bothers me.',
  expectedOutcomes: ['Discuss design alternatives before editing files.'],
  context: [{ description: 'Repository policy', value: 'Do not modify files during discovery.' }],
};

const report = {
  id: 'report-1',
  testCaseId: 'tc-hero',
  name: 'Autonomy calibration #1',
  timestamp: '2025-01-03T00:00:00Z',
  status: 'completed',
  passFailStatus: 'failed',
  metricsStatus: 'ready',
  agentName: 'Test agent',
  modelName: 'test-model',
  metrics: { accuracy: 0 },
  trajectory: [],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGetTestCase.mockResolvedValue(testCase);
  mockGetReports.mockResolvedValue({ reports: [report], total: 1 });
  global.fetch = jest.fn().mockResolvedValue({ ok: false }) as jest.Mock;
});

describe('TestCaseDetailPage definition-first hierarchy', () => {
  it('shows the complete definition as the full-width hero before any run-history interaction', async () => {
    render(React.createElement(TestCaseDetailPage));

    const hero = await screen.findByTestId('test-case-definition-hero');
    expect(within(hero).getByText('Case under evaluation')).toBeTruthy();
    expect(within(hero).getByText(testCase.description)).toBeTruthy();
    expect(within(hero).getByText(testCase.initialPrompt)).toBeTruthy();
    expect(within(hero).getByText(testCase.expectedOutcomes[0])).toBeTruthy();
    expect(within(hero).getByText('Repository policy')).toBeTruthy();
    expect(within(hero).getByText('design-first')).toBeTruthy();
    expect(within(hero).getAllByText('Version 2').length).toBeGreaterThan(0);

    const runsSection = screen.getByTestId('test-case-runs-section');
    const disclosure = within(runsSection).getByRole('button', { name: /Run history/i });
    expect(disclosure.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('run-inspector')).toBeNull();
  });

  it('keeps run history and drill-down available in the secondary disclosure', async () => {
    render(React.createElement(TestCaseDetailPage));

    const runsSection = await screen.findByTestId('test-case-runs-section');
    const disclosure = within(runsSection).getByRole('button', { name: /Run history/i });
    fireEvent.click(disclosure);

    expect(disclosure.getAttribute('aria-expanded')).toBe('true');
    await waitFor(() => expect(screen.getByText('Autonomy calibration #1')).toBeTruthy());
    expect(screen.getByTestId('run-inspector')).toBeTruthy();
  });

  it('falls back to createdAt/default version/"Stored definition" and handles empty version metadata', async () => {
    mockGetTestCase.mockResolvedValue({
      ...testCase,
      currentVersion: undefined,
      updatedAt: undefined,
      sourceFile: 'evals/autonomy.eval.ts',
      versions: [
        { version: 1, createdAt: '2025-01-01T00:00:00Z', context: [], expectedOutcomes: undefined },
        { version: 2, createdAt: '2025-01-02T00:00:00Z', context: [], expectedOutcomes: [] },
      ],
    });

    render(React.createElement(TestCaseDetailPage));

    const hero = await screen.findByTestId('test-case-definition-hero');
    // currentVersion is undefined -> falls back to the "|| 1" default badge.
    expect(within(hero).getAllByText('Version 1').length).toBeGreaterThan(0);
    // sourceFile is set -> "Code-authored" branch of the provenance ternary.
    expect(within(hero).getByText('Code-authored')).toBeTruthy();

    const versionHistory = within(hero).getByTestId('test-case-version-history');
    fireEvent.click(within(versionHistory).getByText('Version history'));
    // expectedOutcomes undefined/empty -> "?.length || 0" fallback, count !== 1 -> plural "s".
    const zeroOutcomeRows = within(versionHistory).getAllByText('0 expected outcomes');
    expect(zeroOutcomeRows.length).toBe(2);
  });

  it('shows "0 runs" (plural) and hides the pass-rate span when there are no reports yet', async () => {
    mockGetReports.mockResolvedValue({ reports: [], total: 0 });

    render(React.createElement(TestCaseDetailPage));

    const runsSection = await screen.findByTestId('test-case-runs-section');
    // totalRuns === 0 -> "0 runs" (plural, totalRuns !== 1) and the
    // `totalRuns > 0 && ...` pass-rate span is not rendered at all.
    await waitFor(() => expect(within(runsSection).getByText('0 runs')).toBeTruthy());
    expect(within(runsSection).queryByText(/% pass rate/)).toBeNull();
  });

  it('pluralizes the run count badge when there is more than one report', async () => {
    mockGetReports.mockResolvedValue({
      reports: [report, { ...report, id: 'report-2', name: 'Autonomy calibration #2' }],
      total: 2,
    });

    render(React.createElement(TestCaseDetailPage));

    const runsSection = await screen.findByTestId('test-case-runs-section');
    await waitFor(() => expect(within(runsSection).getByText('2 runs')).toBeTruthy());
  });
});
