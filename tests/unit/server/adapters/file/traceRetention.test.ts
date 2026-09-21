/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TraceStore } from '@/server/adapters/file/TraceStore';
import { pruneTraceFiles, startTraceRetention, stopTraceRetention, traceRetentionHours, withTraceDirectoryLock } from '@/server/adapters/file/traceRetention';

const HOUR = 3_600_000;
describe('trace file retention', () => {
  let dir: string;
  let original: string | undefined;
  beforeEach(async () => {
    original = process.env.AH_TRACE_RETENTION_HOURS;
    delete process.env.AH_TRACE_RETENTION_HOURS;
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'trace-retention-'));
    jest.spyOn(console, 'info').mockImplementation(() => {});
  });
  afterEach(async () => {
    await stopTraceRetention(dir);
    jest.useRealTimers();
    jest.restoreAllMocks();
    if (original === undefined) delete process.env.AH_TRACE_RETENTION_HOURS;
    else process.env.AH_TRACE_RETENTION_HOURS = original;
    await fs.rm(dir, { recursive: true, force: true });
  });
  async function file(name: string, ageHours: number) {
    const target = path.join(dir, name);
    await fs.writeFile(target, '[]\n');
    const date = new Date(Date.now() - ageHours * HOUR);
    await fs.utimes(target, date, date);
    return target;
  }
  it.each(['', ' ', '0', '-1', 'NaN', 'Infinity', '24h', '1e309'])('disables invalid hours %p', value => {
    expect(traceRetentionHours(value)).toBeUndefined();
  });
  it('accepts finite positive hours, including fractions', () => {
    expect(traceRetentionHours('24')).toBe(24);
    expect(traceRetentionHours('0.5')).toBe(0.5);
  });
  it('keeps unlimited retention by default', async () => {
    await file('old.ndjson', 1000);
    new TraceStore(dir);
    expect(await pruneTraceFiles(dir)).toBe(0);
    expect(await fs.readdir(dir)).toEqual(['old.ndjson']);
  });
  it('deletes only stale regular trace files, not symlinks, directories or unrelated files', async () => {
    await file('old.ndjson', 25);
    await file('legacy.json', 25);
    await file('fresh.ndjson', 23);
    const outside = await file('keep.txt', 25);
    await fs.symlink(outside, path.join(dir, 'link.ndjson'));
    await fs.mkdir(path.join(dir, 'subdir.ndjson'));
    await file('partial.ndjson.123.tmp', 25);
    expect(await pruneTraceFiles(dir, 24)).toBe(2);
    expect((await fs.readdir(dir)).sort()).toEqual(['fresh.ndjson', 'keep.txt', 'link.ndjson', 'partial.ndjson.123.tmp', 'subdir.ndjson']);
    expect(console.info).toHaveBeenCalledWith(expect.stringContaining('deleted 2 trace file(s), 0 failure(s)'));
  });
  it('starts once per directory, sweeps immediately, and sweeps hourly', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    process.env.AH_TRACE_RETENTION_HOURS = '24';
    await file('expired.ndjson', 25);
    new TraceStore(dir);
    new TraceStore(dir);
    expect(jest.getTimerCount()).toBe(1);
    await withTraceDirectoryLock(dir, async () => {});
    expect(await fs.readdir(dir)).toEqual([]);
    await file('aging.ndjson', 23.5);
    jest.advanceTimersByTime(HOUR);
    await withTraceDirectoryLock(dir, async () => {});
    expect(await fs.readdir(dir)).toEqual([]);
    expect(console.info).toHaveBeenCalledTimes(2);
  });
  it('preserves a file refreshed by an in-flight write before a sweep', async () => {
    const target = await file('active.ndjson', 48);
    const writing = withTraceDirectoryLock(dir, async () => {
      await fs.writeFile(target, '{"refreshed":true}\n');
    });
    const sweep = pruneTraceFiles(dir, 24);
    await writing;
    expect(await sweep).toBe(0);
    expect(await fs.readFile(target, 'utf8')).toContain('refreshed');
  });
  it('does not crash on a missing directory or failed removal', async () => {
    expect(await pruneTraceFiles(path.join(dir, 'missing'), 24)).toBe(0);
    await file('old.ndjson', 25);
    jest.spyOn(fs, 'unlink').mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'EACCES' }));
    expect(await pruneTraceFiles(dir, 24)).toBe(0);
    expect(console.info).toHaveBeenLastCalledWith(expect.stringContaining('1 failure(s)'));
  });
  it('stops the shared interval explicitly', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    process.env.AH_TRACE_RETENTION_HOURS = '24';
    startTraceRetention(dir);
    await stopTraceRetention(dir);
    expect(jest.getTimerCount()).toBe(0);
  });
});
