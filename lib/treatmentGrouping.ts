/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type { BenchmarkRun } from '@/types';

export function treatmentGroupCount(runs: BenchmarkRun[]): number {
  return new Set(runs.map(run => run.treatment?.configHash || '__default__')).size;
}
