/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { groupRunsByTreatment, treatmentGroupCount, trialNumber } from '../../../../lib/treatmentGrouping';

const run = (id: string, hash?: string, createdAt = '2026-01-01T00:00:00Z', passed = 0, total = 1) => ({ id, createdAt, stats: { passed, total }, treatment: hash ? { id: `t-${hash}`, label: hash.toUpperCase(), configHash: hash, config: {} } : undefined }) as any;

describe('benchmark treatment grouping', () => {
  it('keeps legacy and single-treatment lists ungrouped', () => {
    expect(treatmentGroupCount([run('a'), run('b')])).toBe(1);
    expect(treatmentGroupCount([run('a', 'same'), run('b', 'same')])).toBe(1);
  });

  it('coalesces interleaved date-sorted trials by first-seen treatment', () => {
    const groups = groupRunsByTreatment([
      run('a2', 'a', '2026-04-01', 1), run('b2', 'b', '2026-03-01', 0),
      run('a1', 'a', '2026-02-01', 1), run('b1', 'b', '2026-01-01', 1),
    ]);
    expect(groups.map(group => group.key)).toEqual(['a', 'b']);
    expect(groups.map(group => group.runs.map(item => item.id))).toEqual([['a2', 'a1'], ['b2', 'b1']]);
    expect(groups.map(group => [group.passed, group.total])).toEqual([[2, 2], [1, 2]]);
    expect(trialNumber(groups[0], groups[0].runs[0])).toBe(2);
    expect(trialNumber(groups[0], groups[0].runs[1])).toBe(1);
  });
});
