/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { summarizeUnifiedRunResults } from '@/cli/utils/evaluationRunOutcome';
import type { EvaluationRun } from '@/types';

function run(results: Record<string, unknown>, status = 'completed', count = Object.keys(results).length): EvaluationRun {
  return { status, results, testCaseSnapshots: Array.from({ length: count }, (_, i) => ({ id: `tc-${i}` })) } as EvaluationRun;
}

const passed = { status: 'completed', passFailStatus: 'passed' };
const failed = { status: 'completed', passFailStatus: 'failed' };
const errored = { status: 'completed' };

describe('unified benchmark result summary', () => {
  it('counts verdicts rather than completed lifecycle states', () => {
    expect(summarizeUnifiedRunResults(run({ a: passed, b: failed, c: errored }))).toEqual({
      passed: 1, failed: 1, errored: 1, pending: 0, notRun: 0, total: 3, exitCode: 1,
    });
  });

  it.each([
    ['all passed', { a: passed }, 1, 0],
    ['gate failed', { a: failed }, 0, 1],
    ['agent or judge errored without a verdict', { a: errored }, 0, 1],
    ['execution failed', { a: { status: 'failed' } }, 0, 1],
    ['unknown terminal state', { a: { status: 'unknown' } }, 0, 1],
    ['nothing evaluated', {}, 0, 1],
  ])('%s', (_name, results, expectedPassed, exitCode) => {
    expect(summarizeUnifiedRunResults(run(results))).toMatchObject({ passed: expectedPassed, exitCode });
  });

  it('does not trust stale denormalized stats', () => {
    const input = { ...run({ a: errored }), stats: { passed: 1, total: 1 } } as EvaluationRun;
    expect(summarizeUnifiedRunResults(input)).toMatchObject({ passed: 0, errored: 1, exitCode: 1 });
  });

  it('fails closed for missing cases using the larger snapshotted or SSE total', () => {
    expect(summarizeUnifiedRunResults(run({ a: passed }, 'completed', 2), 3)).toMatchObject({
      passed: 1, notRun: 2, total: 3, exitCode: 1,
    });
  });

  it.each(['pending', 'running', 'failed', 'cancelled'])('does not succeed for a %s run', (status) => {
    expect(summarizeUnifiedRunResults(run({ a: passed }, status)).exitCode).toBe(1);
  });
});
