/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { treatmentGroupCount } from '../../../../lib/treatmentGrouping';

const run = (id: string, hash?: string) => ({ id, treatment: hash ? { id: `t-${hash}`, configHash: hash, config: {} } : undefined }) as any;

describe('benchmark treatment grouping', () => {
  it('keeps legacy and single-treatment lists ungrouped', () => {
    expect(treatmentGroupCount([run('a'), run('b')])).toBe(1);
    expect(treatmentGroupCount([run('a', 'same'), run('b', 'same')])).toBe(1);
  });

  it('groups only when multiple treatment hashes are present', () => {
    expect(treatmentGroupCount([run('a', 'one'), run('b', 'two')])).toBe(2);
    expect(treatmentGroupCount([run('a'), run('b', 'two')])).toBe(2);
  });
});
