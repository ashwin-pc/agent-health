/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AgentConfig, TestCase, Treatment } from '@/types';
import type { AgentConnector, TreatmentOverlays } from '@/services/connectors/types';
import { createTreatment } from '@/lib/treatment';

export async function resolveTreatment(
  declared: Treatment,
  agent: AgentConfig,
  connector: AgentConnector,
  modelId: string,
  testCase?: TestCase,
): Promise<Treatment> {
  const overlays = declared.config.overlays as TreatmentOverlays | undefined;
  const environment = await connector.describeEnvironment?.({
    testCase: testCase || ({ initialPrompt: '' } as TestCase),
    modelId,
    connectorConfig: agent.connectorConfig,
    overlays,
  });
  return createTreatment({
    ...declared.config,
    agent: { key: agent.key, endpoint: agent.endpoint },
    modelId,
    connector: agent.connectorType || connector.type,
    environment: environment || {},
  }, declared.label);
}
