/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import fc from 'fast-check';
import { RunAggregateMetrics } from '@/types';
import { getVisibleMetricRows } from '@/components/comparison/RunSummaryTable';

/**
 * Feature: pr-cleanup-and-compare-refinement
 * Property 2: Aggregated view accepts any number of runs >= 2
 *
 * Validates: Requirements 3.1, 3.2
 *
 * This test verifies that the data transformation logic feeding RunSummaryTable
 * and AggregateMetricsChart works correctly for any array of RunAggregateMetrics
 * with length ≥ 2. Specifically:
 * - getVisibleMetricRows returns a non-empty array for any valid input
 * - Each run's data can be extracted via getValue(run) for every visible row
 * - The function handles both with and without trace metrics
 */

// Mock DEFAULT_CONFIG to avoid importing real config
jest.mock('@/lib/constants', () => ({
  DEFAULT_CONFIG: {
    agents: [
      { key: 'q-business', name: 'Q Business' },
      { key: 'bedrock-agent', name: 'Bedrock Agent' },
      { key: 'custom-agent', name: 'Custom Agent' },
    ],
    models: {},
  },
}));

// --- Arbitraries ---

/** Generates a valid ISO date string within a reasonable range using integer timestamps */
const isoDateArb: fc.Arbitrary<string> = fc
  .integer({
    min: new Date('2020-01-01T00:00:00Z').getTime(),
    max: new Date('2030-12-31T23:59:59Z').getTime(),
  })
  .map(ts => new Date(ts).toISOString());

/** Generates a random RunAggregateMetrics without trace metrics */
const runAggregateArb: fc.Arbitrary<RunAggregateMetrics> = fc.record({
  runId: fc.uuid(),
  runName: fc.string({ minLength: 1, maxLength: 30 }),
  agentKey: fc.constantFrom('q-business', 'bedrock-agent', 'custom-agent'),
  modelId: fc.constantFrom('claude-3-sonnet', 'claude-3-haiku', 'gpt-4'),
  createdAt: isoDateArb,
  totalTestCases: fc.integer({ min: 1, max: 100 }),
  passedCount: fc.integer({ min: 0, max: 100 }),
  failedCount: fc.integer({ min: 0, max: 100 }),
  passRatePercent: fc.integer({ min: 0, max: 100 }),
  avgAccuracy: fc.integer({ min: 0, max: 100 }),
});

/** Generates a RunAggregateMetrics with trace metrics populated */
const runAggregateWithTracesArb: fc.Arbitrary<RunAggregateMetrics> = fc.record({
  runId: fc.uuid(),
  runName: fc.string({ minLength: 1, maxLength: 30 }),
  agentKey: fc.constantFrom('q-business', 'bedrock-agent', 'custom-agent'),
  modelId: fc.constantFrom('claude-3-sonnet', 'claude-3-haiku', 'gpt-4'),
  createdAt: isoDateArb,
  totalTestCases: fc.integer({ min: 1, max: 100 }),
  passedCount: fc.integer({ min: 0, max: 100 }),
  failedCount: fc.integer({ min: 0, max: 100 }),
  passRatePercent: fc.integer({ min: 0, max: 100 }),
  avgAccuracy: fc.integer({ min: 0, max: 100 }),
  totalTokens: fc.integer({ min: 100, max: 5000000 }),
  totalInputTokens: fc.integer({ min: 50, max: 2500000 }),
  totalOutputTokens: fc.integer({ min: 50, max: 2500000 }),
  totalCostUsd: fc.float({ min: Math.fround(0.01), max: Math.fround(500), noNaN: true }),
  avgDurationMs: fc.integer({ min: 100, max: 300000 }),
  totalLlmCalls: fc.integer({ min: 1, max: 1000 }),
  totalToolCalls: fc.integer({ min: 0, max: 500 }),
});

/** Generates an array of RunAggregateMetrics (no traces) with length 2–20 */
const runsArrayArb: fc.Arbitrary<RunAggregateMetrics[]> = fc
  .integer({ min: 2, max: 20 })
  .chain((len) => fc.array(runAggregateArb, { minLength: len, maxLength: len }));

/** Generates an array of RunAggregateMetrics (with traces) with length 2–20 */
const runsWithTracesArrayArb: fc.Arbitrary<RunAggregateMetrics[]> = fc
  .integer({ min: 2, max: 20 })
  .chain((len) => fc.array(runAggregateWithTracesArb, { minLength: len, maxLength: len }));

/** Generates a mixed array where some runs have traces and some don't */
const mixedRunsArrayArb: fc.Arbitrary<RunAggregateMetrics[]> = fc
  .integer({ min: 2, max: 20 })
  .chain((len) =>
    fc.array(fc.oneof(runAggregateArb, runAggregateWithTracesArb), {
      minLength: len,
      maxLength: len,
    })
  );

describe('Aggregated View — Property-Based Tests', () => {
  describe('Property 2: Aggregated view accepts any number of runs >= 2', () => {
    it('getVisibleMetricRows returns a non-empty array for any array of runs with length >= 2 (no traces)', () => {
      fc.assert(
        fc.property(runsArrayArb, (runs) => {
          const rows = getVisibleMetricRows(runs);
          expect(rows.length).toBeGreaterThan(0);
        }),
        { numRuns: 100 },
      );
    });

    it('getVisibleMetricRows returns a non-empty array for any array of runs with length >= 2 (with traces)', () => {
      fc.assert(
        fc.property(runsWithTracesArrayArb, (runs) => {
          const rows = getVisibleMetricRows(runs);
          expect(rows.length).toBeGreaterThan(0);
        }),
        { numRuns: 100 },
      );
    });

    it('getValue produces a string for every run and every visible row (no traces)', () => {
      fc.assert(
        fc.property(runsArrayArb, (runs) => {
          const rows = getVisibleMetricRows(runs);
          for (const row of rows) {
            for (const run of runs) {
              const value = row.getValue(run);
              expect(typeof value).toBe('string');
              expect(value.length).toBeGreaterThan(0);
            }
          }
        }),
        { numRuns: 100 },
      );
    });

    it('getValue produces a string for every run and every visible row (with traces)', () => {
      fc.assert(
        fc.property(runsWithTracesArrayArb, (runs) => {
          const rows = getVisibleMetricRows(runs);
          for (const row of rows) {
            for (const run of runs) {
              const value = row.getValue(run);
              expect(typeof value).toBe('string');
              expect(value.length).toBeGreaterThan(0);
            }
          }
        }),
        { numRuns: 100 },
      );
    });

    it('all 8 metric rows are visible when trace data is present, 5 when absent', () => {
      fc.assert(
        fc.property(mixedRunsArrayArb, (runs) => {
          const rows = getVisibleMetricRows(runs);
          const hasTraceMetrics = runs.some(r => r.totalTokens !== undefined);
          if (hasTraceMetrics) {
            expect(rows).toHaveLength(8);
          } else {
            expect(rows).toHaveLength(5);
          }
        }),
        { numRuns: 100 },
      );
    });

    it('every run in the input array can be processed by all visible rows without error', () => {
      fc.assert(
        fc.property(mixedRunsArrayArb, (runs) => {
          const rows = getVisibleMetricRows(runs);
          // Verify no exceptions are thrown when extracting data for every run
          for (const row of rows) {
            for (const run of runs) {
              expect(() => row.getValue(run)).not.toThrow();
              if (row.getNumericValue) {
                expect(() => row.getNumericValue!(run)).not.toThrow();
              }
            }
          }
        }),
        { numRuns: 100 },
      );
    });

    it('the number of runs does not affect the set of visible metric keys', () => {
      fc.assert(
        fc.property(runsArrayArb, runsArrayArb, (runsA, runsB) => {
          // Both arrays have no trace metrics, so visible rows should be identical
          const keysA = getVisibleMetricRows(runsA).map(r => r.key);
          const keysB = getVisibleMetricRows(runsB).map(r => r.key);
          expect(keysA).toEqual(keysB);
        }),
        { numRuns: 100 },
      );
    });
  });
});
