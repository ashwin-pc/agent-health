/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { getJudgeVerdict, getTraceNotice } from '@/lib/reportVerdict';
import { getResultStatus } from '@/components/evals3/ResultStatus';
import type { EvaluationReport } from '@/types';

function report(overrides: Partial<EvaluationReport> = {}): EvaluationReport {
  return {
    id: 'report-1',
    timestamp: '2026-01-01T00:00:00.000Z',
    testCaseId: 'tc-1',
    status: 'completed',
    agentName: 'Agent',
    agentKey: 'agent',
    modelName: 'model',
    trajectory: [],
    metrics: { accuracy: 0 },
    llmJudgeReasoning: '',
    ...overrides,
  };
}

const traceTimeout = 'Traces never arrived (kind=trace_timeout): no spans after 1 attempt';

describe('report verdict derivation (#407)', () => {
  it('keeps a judge PASS authoritative when a no-trace run has a stale trace timeout', () => {
    const input = report({
      metricsStatus: 'error',
      traceStatus: 'not_configured',
      traceError: traceTimeout,
      passFailStatus: undefined,
      matcherResults: [{
        description: 'judge: expected outcomes',
        method: 'llm-judge',
        pass: true,
        score: 1,
      }],
    });

    expect(getJudgeVerdict(input)).toEqual({
      status: 'passed',
      score: 100,
      source: 'matcherResults',
    });
    expect(getResultStatus({ status: 'completed' }, input)).toBe('passed');
    expect(getTraceNotice(input)).toEqual(expect.objectContaining({
      tone: 'info',
      title: 'Traces not configured',
    }));
  });

  it('keeps a judge FAIL authoritative when traces are not configured', () => {
    const input = report({
      traceStatus: 'not_configured',
      matcherResults: [{
        description: 'judge: expected outcomes',
        method: 'llm-judge',
        pass: false,
        score: 0.2,
      }],
    });

    expect(getJudgeVerdict(input)).toEqual({
      status: 'failed',
      score: 20,
      source: 'matcherResults',
    });
    expect(getResultStatus({ status: 'completed' }, input)).toBe('failed');
  });

  it('renders a useTraces=true timeout as a warning without changing the verdict', () => {
    const input = report({
      metricsStatus: 'error',
      traceStatus: 'unavailable',
      traceError: traceTimeout,
      passFailStatus: 'passed',
      metrics: { accuracy: 100 },
    });

    expect(getJudgeVerdict(input)?.status).toBe('passed');
    expect(getResultStatus({ status: 'completed' }, input)).toBe('passed');
    expect(getTraceNotice(input, { traceExpected: true })).toEqual(expect.objectContaining({
      tone: 'warning',
      title: 'Traces unavailable',
    }));
  });

  it('keeps legacy metric percentages on their 0–100 scale', () => {
    expect(getJudgeVerdict(report({
      passFailStatus: 'failed',
      metrics: { accuracy: 1 },
    }))?.score).toBe(1);
  });

  it('does not synthesize a verdict from evaluator-error reasoning', () => {
    expect(getJudgeVerdict(report({
      metricsStatus: 'error',
      llmJudgeReasoning: '**Evaluator could not run.**',
    }))).toBeNull();
  });
});
