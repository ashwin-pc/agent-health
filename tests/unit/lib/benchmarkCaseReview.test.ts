/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  buildCaseReviewRows,
  classifyCaseVerdicts,
  deriveCaseVerdict,
  filterAndSortCaseRows,
  getCasePagerPosition,
  getRecentCompletedRuns,
  type CaseReviewRow,
  type ReviewableCase,
  type VerdictRun,
} from '@/lib/benchmarkCaseReview';

function run(
  id: string,
  createdAt: string,
  results: VerdictRun['results'],
  status = 'completed',
): VerdictRun {
  return { id, createdAt, status, results };
}

describe('benchmark case-review verdicts', () => {
  it('classifies attention, flaky, stable, errored, and never-run histories by priority', () => {
    expect(classifyCaseVerdicts(['passed', 'failed', 'passed'])).toBe('needs-attention');
    expect(classifyCaseVerdicts(['passed', 'passed', 'passed', 'failed', 'passed'])).toBe('flaky');
    expect(classifyCaseVerdicts(['passed', 'not-run', 'passed'])).toBe('stable');

    // An evaluator error needs operator attention but remains distinct from a
    // failed agent verdict and does not count toward pass rate.
    expect(classifyCaseVerdicts(['errored', 'passed'])).toBe('needs-attention');
    expect(classifyCaseVerdicts(['not-run', 'not-run'])).toBe('no-data');
  });

  it('derives sparkline and heat-strip cells from report verdict documents', () => {
    const completed = run('r1', '2025-01-05T00:00:00Z', {
      pass: { reportId: 'rp', status: 'completed' },
      fail: { reportId: 'rf', status: 'completed' },
      error: { reportId: 're', status: 'completed', passFailStatus: 'passed' },
      executionFailure: { reportId: 'rx', status: 'failed' },
    });
    const reports = {
      rp: { passFailStatus: 'passed' as const },
      rf: { passFailStatus: 'failed' as const },
      // metricsStatus must override a stale denormalized pass.
      re: { metricsStatus: 'error', passFailStatus: 'passed' as const },
      rx: { status: 'failed' },
    };

    expect(deriveCaseVerdict(completed, 'pass', reports)).toBe('passed');
    expect(deriveCaseVerdict(completed, 'fail', reports)).toBe('failed');
    expect(deriveCaseVerdict(completed, 'error', reports)).toBe('errored');
    expect(deriveCaseVerdict(completed, 'executionFailure', reports)).toBe('failed');
    expect(deriveCaseVerdict(completed, 'missing', reports)).toBe('not-run');
  });

  it('uses only the five newest completed runs and preserves newest-first cell order', () => {
    const runs: VerdictRun[] = [
      run('old', '2025-01-01T00:00:00Z', { c1: { reportId: 'old', status: 'completed' } }),
      run('new', '2025-01-07T00:00:00Z', { c1: { reportId: 'new', status: 'completed' } }),
      run('mid', '2025-01-05T00:00:00Z', { c1: { reportId: 'mid', status: 'completed' } }),
      run('running', '2025-01-08T00:00:00Z', { c1: { reportId: 'running', status: 'running' } }, 'running'),
      run('four', '2025-01-04T00:00:00Z', { c1: { reportId: 'four', status: 'completed' } }),
      run('three', '2025-01-03T00:00:00Z', { c1: { reportId: 'three', status: 'completed' } }),
      run('six', '2025-01-06T00:00:00Z', { c1: { reportId: 'six', status: 'completed' } }),
      run('two', '2025-01-02T00:00:00Z', { c1: { reportId: 'two', status: 'completed' } }),
    ];

    const recent = getRecentCompletedRuns(runs);
    expect(recent.map(item => item.id)).toEqual(['new', 'six', 'mid', 'four', 'three']);

    const rows = buildCaseReviewRows(
      [{ id: 'c1', name: 'Case one', prompt: 'Investigate' }],
      recent,
      {
        new: { passFailStatus: 'failed' },
        six: { passFailStatus: 'passed' },
        mid: { metricsStatus: 'error' },
        four: { passFailStatus: 'passed' },
        three: { passFailStatus: 'failed' },
      },
    );
    expect(rows[0].verdicts).toEqual(['failed', 'passed', 'errored', 'passed', 'failed']);
  });
});

describe('benchmark case-review filtered pager', () => {
  const reviewCase = (id: string, name: string, prompt: string): ReviewableCase => ({ id, name, prompt });
  const row = (
    testCase: ReviewableCase,
    passRate: number | null,
    bucket: CaseReviewRow['bucket'],
  ): CaseReviewRow => ({ testCase, passRate, bucket, verdicts: [] });

  const rows = [
    row(reviewCase('stable', 'Zulu stable', 'routine check'), 1, 'stable'),
    row(reviewCase('attention-b', 'Beta failure', 'database timeout'), 0, 'needs-attention'),
    row(reviewCase('attention-a', 'Alpha failure', 'network timeout'), 0, 'needs-attention'),
    row(reviewCase('flaky', 'Gamma flaky', 'network retry'), 0.5, 'flaky'),
    row(reviewCase('no-data', 'Never run', 'network fixture'), null, 'no-data'),
  ];

  it('searches name+prompt, filters buckets, and sorts by pass rate then name', () => {
    expect(filterAndSortCaseRows(rows, '', 'all').map(item => item.testCase.id)).toEqual([
      'attention-a', 'attention-b', 'flaky', 'stable', 'no-data',
    ]);
    expect(filterAndSortCaseRows(rows, 'network', 'all').map(item => item.testCase.id)).toEqual([
      'attention-a', 'flaky', 'no-data',
    ]);
    expect(filterAndSortCaseRows(rows, '', 'needs-attention').map(item => item.testCase.id)).toEqual([
      'attention-a', 'attention-b',
    ]);
  });

  it('pages over the current filtered and sorted list', () => {
    const filtered = filterAndSortCaseRows(rows, 'network', 'all');
    expect(getCasePagerPosition(filtered, 'flaky')).toEqual({
      index: 1,
      position: 2,
      total: 3,
      previousId: 'attention-a',
      nextId: 'no-data',
    });
  });
});
