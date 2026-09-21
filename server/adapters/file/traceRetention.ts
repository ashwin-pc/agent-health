/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { promises as fs } from 'fs';
import * as path from 'path';

const HOUR_MS = 60 * 60 * 1000;
// File observability constructs stores per request. Share one janitor per
// directory, not one timer per instance, and serialize it with local writes.
const timers = new Map<string, ReturnType<typeof setInterval>>();
const operations = new Map<string, Promise<unknown>>();

export function traceRetentionHours(value = process.env.AH_TRACE_RETENTION_HOURS): number | undefined {
  if (!value?.trim()) return undefined;
  const hours = Number(value);
  return Number.isFinite(hours) && hours > 0 && Number.isFinite(hours * HOUR_MS) ? hours : undefined;
}

export async function withTraceDirectoryLock<T>(dir: string, action: () => Promise<T>): Promise<T> {
  const key = path.resolve(dir);
  const previous = operations.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(action);
  operations.set(key, current);
  try { return await current; }
  finally { if (operations.get(key) === current) operations.delete(key); }
}

/** Delete only regular trace files; never follow symlinks or descend directories. */
export async function pruneTraceFiles(dir: string, hours = traceRetentionHours(), now = Date.now()): Promise<number> {
  if (hours === undefined || !Number.isFinite(hours) || hours <= 0) return 0;
  return withTraceDirectoryLock(dir, async () => {
    let deleted = 0;
    let failed = 0;
    const cutoff = now - hours * HOUR_MS;
    try {
      for (const name of await fs.readdir(dir)) {
        // JSON is the original file layout; NDJSON is the canonical span layout.
        if (!name.endsWith('.json') && !name.endsWith('.ndjson')) continue;
        const file = path.join(dir, name);
        try {
          const stat = await fs.lstat(file);
          if (stat.isFile() && stat.mtimeMs < cutoff) {
            await fs.unlink(file);
            deleted++;
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') failed++;
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') failed++;
    }
    console.info(`[TraceStore] Retention ${hours}h: deleted ${deleted} trace file(s), ${failed} failure(s)`);
    return deleted;
  });
}

/** Start once per directory. Missing/invalid/non-positive configuration is off. */
export function startTraceRetention(dir: string): void {
  const hours = traceRetentionHours();
  const key = path.resolve(dir);
  if (hours === undefined || timers.has(key)) return;
  const sweep = () => { void pruneTraceFiles(key, hours).catch(() => {}); };
  const timer = setInterval(sweep, HOUR_MS);
  timer.unref?.();
  timers.set(key, timer);
  sweep();
}

/** Stop a directory's shared janitor during host shutdown or test teardown. */
export async function stopTraceRetention(dir: string): Promise<void> {
  const key = path.resolve(dir);
  const timer = timers.get(key);
  if (timer) clearInterval(timer);
  timers.delete(key);
  await operations.get(key)?.catch(() => {});
}
