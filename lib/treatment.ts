/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash, randomUUID } from 'node:crypto';

export interface Treatment {
  id: string;
  label?: string;
  configHash: string;
  /** Resolved configuration snapshot. Opaque to Agent Health storage. */
  config: Record<string, unknown>;
}

/** JSON serialization with recursively sorted object keys. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function treatmentHash(config: Record<string, unknown>): string {
  return createHash('sha256').update(canonicalJson(config)).digest('hex');
}

export function createTreatment(config: Record<string, unknown>, label?: string): Treatment {
  const configHash = treatmentHash(config);
  return {
    id: `treatment-${configHash}`,
    label: label?.trim() || configHash.slice(0, 8),
    configHash,
    config,
  };
}

export function createTrialId(): string {
  return `trial-${randomUUID()}`;
}
