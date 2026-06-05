/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Jest mock for traceJudgeExtensionPath — the real module uses import.meta.url,
 * which Jest's CJS transform cannot handle. Returns a stable cwd-relative path
 * that still ends with `server/pi/extensions/trace-judge.ts` so wiring
 * assertions hold.
 */
import { resolve } from 'path';

export function getTraceJudgeExtensionPath(): string {
  return resolve(process.cwd(), 'server/pi/extensions/trace-judge.ts');
}
