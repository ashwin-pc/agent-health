/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { canonicalJson, createTreatment, createTrialIds, treatmentHash } from '../../../lib/treatment';

describe('treatment identity', () => {
  it('canonicalizes object keys recursively while preserving arrays', () => {
    expect(canonicalJson({ z: 1, a: { y: 2, x: 3 }, list: [{ b: 1, a: 2 }] }))
      .toBe('{"a":{"x":3,"y":2},"list":[{"a":2,"b":1}],"z":1}');
  });

  it('gives identical resolved configs identical sha256 identities', () => {
    const left = { model: 'm', environment: { skills: ['one'], fixture: { b: 2, a: 1 } } };
    const right = { environment: { fixture: { a: 1, b: 2 }, skills: ['one'] }, model: 'm' };
    expect(treatmentHash(left)).toMatch(/^[a-f0-9]{64}$/);
    expect(treatmentHash(left)).toBe(treatmentHash(right));
    expect(createTreatment(left).id).toBe(createTreatment(right).id);
    expect(treatmentHash({ a: 1, b: undefined })).toBe(treatmentHash({ a: 1 }));
    expect(treatmentHash({ a: 1 })).not.toBe(treatmentHash({ a: 2 }));
  });

  it('creates N distinct trials sharing one treatment hash', () => {
    const treatment = createTreatment({ model: 'm', environment: {} });
    const runs = createTrialIds(3).map(trialId => ({ trialId, treatment }));
    expect(new Set(runs.map(run => run.trialId)).size).toBe(3);
    expect(new Set(runs.map(run => run.treatment.configHash))).toEqual(new Set([treatment.configHash]));
  });
});
