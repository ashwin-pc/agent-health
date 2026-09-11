/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type { BenchmarkRun } from '@/types';

export interface TreatmentRunGroup {
  key: string;
  label: string;
  hash?: string;
  runs: BenchmarkRun[];
  passed: number;
  total: number;
}

export function groupRunsByTreatment(runs: BenchmarkRun[]): TreatmentRunGroup[] {
  const groups = new Map<string, TreatmentRunGroup>();
  for (const run of runs) {
    const key = run.treatment?.configHash || '__default__';
    let group = groups.get(key);
    if (!group) {
      group = { key, label: run.treatment?.label || 'Default', hash: run.treatment?.configHash, runs: [], passed: 0, total: 0 };
      groups.set(key, group);
    }
    group.runs.push(run);
    group.passed += run.stats?.passed || 0;
    group.total += run.stats?.total || 0;
  }
  return [...groups.values()].map(group => ({
    ...group,
    runs: [...group.runs].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
  }));
}

export function treatmentGroupCount(runs: BenchmarkRun[]): number {
  return groupRunsByTreatment(runs).length;
}

export function trialNumber(group: TreatmentRunGroup, run: BenchmarkRun): number {
  return [...group.runs]
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
    .findIndex(candidate => candidate.id === run.id) + 1;
}
