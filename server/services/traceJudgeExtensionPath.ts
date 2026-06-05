/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Resolves the absolute path to the shipped trace-judge pi extension.
 *
 * Isolated into its own module because it uses `import.meta.url` (required so
 * the path resolves relative to THIS package rather than the server's
 * `process.cwd()` — e.g. when the server runs from a consumer project dir).
 * Jest's CJS transform can't handle `import.meta`, so this module is mocked
 * via `moduleNameMapper` (see `__mocks__/@/server/services/traceJudgeExtensionPath.ts`).
 */

import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

/** Absolute path to `server/pi/extensions/trace-judge.ts`, package-relative. */
export function getTraceJudgeExtensionPath(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const candidates = [
      resolve(here, '../pi/extensions/trace-judge.ts'), // <pkg>/server/dist -> <pkg>/server/pi/...
      resolve(here, 'pi/extensions/trace-judge.ts'),    // <pkg>/server (tsx/dev)
    ];
    for (const c of candidates) {
      if (existsSync(c)) return c;
    }
  } catch {
    /* import.meta.url unavailable in some bundles — fall through to cwd */
  }
  return resolve(process.cwd(), 'server/pi/extensions/trace-judge.ts');
}
