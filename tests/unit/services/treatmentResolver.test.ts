/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { createTreatment } from '../../../lib/treatment';
import { resolveTreatment } from '../../../services/treatmentResolver';

describe('resolveTreatment', () => {
  it('uses a stable empty environment for connectors without a report', async () => {
    const declared = createTreatment({ overlays: { env: { A: '1' } } }, 'A');
    const agent = { key: 'http', name: 'HTTP', endpoint: 'https://agent', connectorType: 'rest' } as any;
    const connector = { type: 'rest', name: 'REST', supportsStreaming: false } as any;
    const first = await resolveTreatment(declared, agent, connector, 'model');
    const second = await resolveTreatment(declared, agent, connector, 'model');
    expect(first.config.environment).toEqual({});
    expect(first.configHash).toBe(second.configHash);
  });
});
