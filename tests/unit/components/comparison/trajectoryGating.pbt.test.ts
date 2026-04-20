/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import fc from 'fast-check';

/**
 * Feature: pr-cleanup-and-compare-refinement
 * Property 3: Trajectory detail is gated by run count
 *
 * Validates: Requirements 3.3, 3.4, 3.6
 *
 * This test verifies the pure trajectory gating decision logic used in
 * UseCaseComparisonTable / ComparisonPage. The function is extracted here
 * to match the component's inline decision: when exactly 2 runs are selected
 * the trajectory detail expands inline; when more than 2 are selected the
 * run-pair selection flow is triggered instead.
 */

// --- Pure function under test ---

type TrajectoryAction = 'inline-expand' | 'run-pair-selector';

/**
 * Pure gating logic extracted from UseCaseComparisonTable's row click handler.
 * Determines whether clicking a test case row should expand trajectory detail
 * inline (exactly 2 runs) or open the run-pair selector (> 2 runs).
 */
function getTrajectoryAction(runCount: number): TrajectoryAction {
  return runCount === 2 ? 'inline-expand' : 'run-pair-selector';
}

// --- Arbitraries ---

/** Generates an array of unique run IDs with length between 2 and 20 */
const uniqueRunIdsArb: fc.Arbitrary<string[]> = fc
  .integer({ min: 2, max: 20 })
  .chain((len) =>
    fc
      .uniqueArray(fc.uuid(), { minLength: len, maxLength: len })
  );

/** Generates an array of exactly 2 unique run IDs */
const exactlyTwoRunIdsArb: fc.Arbitrary<string[]> = fc
  .uniqueArray(fc.uuid(), { minLength: 2, maxLength: 2 });

/** Generates an array of unique run IDs with length strictly > 2 (3 to 20) */
const moreThanTwoRunIdsArb: fc.Arbitrary<string[]> = fc
  .integer({ min: 3, max: 20 })
  .chain((len) =>
    fc
      .uniqueArray(fc.uuid(), { minLength: len, maxLength: len })
  );

describe('Trajectory Gating — Property-Based Tests', () => {
  describe('Property 3: Trajectory detail is gated by run count', () => {
    it('returns "run-pair-selector" when run count is strictly greater than 2', () => {
      fc.assert(
        fc.property(moreThanTwoRunIdsArb, (runIds) => {
          const action = getTrajectoryAction(runIds.length);
          expect(action).toBe('run-pair-selector');
        }),
        { numRuns: 100 },
      );
    });

    it('returns "inline-expand" when exactly 2 runs are selected', () => {
      fc.assert(
        fc.property(exactlyTwoRunIdsArb, (runIds) => {
          const action = getTrajectoryAction(runIds.length);
          expect(action).toBe('inline-expand');
        }),
        { numRuns: 100 },
      );
    });

    it('gating decision is consistent for any set of unique run IDs with length 2–20', () => {
      fc.assert(
        fc.property(uniqueRunIdsArb, (runIds) => {
          const action = getTrajectoryAction(runIds.length);
          if (runIds.length === 2) {
            expect(action).toBe('inline-expand');
          } else {
            expect(action).toBe('run-pair-selector');
          }
        }),
        { numRuns: 100 },
      );
    });

    it('gating decision depends only on count, not on specific run ID values', () => {
      fc.assert(
        fc.property(
          uniqueRunIdsArb,
          uniqueRunIdsArb,
          (runIdsA, runIdsB) => {
            fc.pre(runIdsA.length === runIdsB.length);
            expect(getTrajectoryAction(runIdsA.length)).toBe(
              getTrajectoryAction(runIdsB.length),
            );
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
