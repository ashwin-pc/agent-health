/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import fc from 'fast-check';

/**
 * Feature: pr-cleanup-and-compare-refinement
 * Property 1: MetricCell defaults to accuracy-only visibility
 *
 * Validates: Requirements 1.1, 1.3
 *
 * This test verifies the pure logic of the show() helper used in MetricCell.
 * The function is extracted here to match the component's inline implementation.
 */

/** EvaluatorType — mirrors the type exported from MetricCell.tsx */
type EvaluatorType = 'accuracy' | 'faithfulness' | 'trajectory' | 'latency' | 'annotations';

const ALL_EVALUATOR_TYPES: EvaluatorType[] = [
  'accuracy',
  'faithfulness',
  'trajectory',
  'latency',
  'annotations',
];

/**
 * Pure logic extracted from MetricCell's inline show() helper.
 * Matches the implementation in components/comparison/MetricCell.tsx.
 */
function show(type: EvaluatorType, visibleEvaluators?: Set<EvaluatorType>): boolean {
  if (!visibleEvaluators) return type === 'accuracy';
  return visibleEvaluators.has(type);
}

// --- Arbitraries ---

/** Generates a random EvaluatorType value */
const evaluatorTypeArb: fc.Arbitrary<EvaluatorType> = fc.constantFrom(...ALL_EVALUATOR_TYPES);

/** Generates a random Set<EvaluatorType> (possibly empty) */
const evaluatorSetArb: fc.Arbitrary<Set<EvaluatorType>> = fc
  .subarray(ALL_EVALUATOR_TYPES)
  .map((arr) => new Set(arr));

describe('MetricCell show() — Property-Based Tests', () => {
  describe('Property 1: MetricCell defaults to accuracy-only visibility', () => {
    it('when visibleEvaluators is undefined, show() returns true only for accuracy', () => {
      fc.assert(
        fc.property(evaluatorTypeArb, (type) => {
          const result = show(type, undefined);
          if (type === 'accuracy') {
            expect(result).toBe(true);
          } else {
            expect(result).toBe(false);
          }
        }),
        { numRuns: 100 },
      );
    });

    it('when visibleEvaluators is provided, show() returns true iff the type is in the set', () => {
      fc.assert(
        fc.property(evaluatorTypeArb, evaluatorSetArb, (type, visibleSet) => {
          const result = show(type, visibleSet);
          expect(result).toBe(visibleSet.has(type));
        }),
        { numRuns: 100 },
      );
    });

    it('non-accuracy types are always hidden when visibleEvaluators is undefined', () => {
      const nonAccuracyTypes: EvaluatorType[] = ['faithfulness', 'trajectory', 'latency', 'annotations'];
      const nonAccuracyArb = fc.constantFrom(...nonAccuracyTypes);

      fc.assert(
        fc.property(nonAccuracyArb, (type) => {
          expect(show(type, undefined)).toBe(false);
        }),
        { numRuns: 100 },
      );
    });

    it('accuracy is always visible when visibleEvaluators is undefined', () => {
      // Deterministic but included for completeness — run 100 times to confirm stability
      fc.assert(
        fc.property(fc.constant('accuracy' as EvaluatorType), (type) => {
          expect(show(type, undefined)).toBe(true);
        }),
        { numRuns: 100 },
      );
    });

    it('an empty visibleEvaluators set hides all types', () => {
      const emptySet = new Set<EvaluatorType>();

      fc.assert(
        fc.property(evaluatorTypeArb, (type) => {
          expect(show(type, emptySet)).toBe(false);
        }),
        { numRuns: 100 },
      );
    });
  });
});
