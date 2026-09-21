/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { createServer, type Server } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

// Exercise the real built CLI and its OS exit code, with only the remote
// evaluation service replaced. Never connect to the developer's live server.
describe('benchmark summary process exit codes', () => {
  let server: Server;
  let cwd: string;
  let verdict: string | undefined;
  const root = resolve(__dirname, '../../..');

  beforeAll(async () => {
    cwd = mkdtempSync(join(tmpdir(), 'ah-summary-cli-'));
    const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
    server = createServer((req, res) => {
      if (req.url === '/health') {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ status: 'ok', version }));
      } else if (req.method === 'POST' && req.url === '/api/storage/evaluation-runs') {
        req.resume();
        res.setHeader('Content-Type', 'text/event-stream');
        res.end('data: {"runId":"summary-run","testCases":[{"id":"summary-case"}]}\n\n'
          + 'data: {"status":"completed"}\n\n');
      } else if (req.url === '/api/storage/evaluation-runs/summary-run') {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
          id: 'summary-run', status: 'completed', testCaseSnapshots: [{ id: 'summary-case' }],
          results: { 'summary-case': { status: 'completed', passFailStatus: verdict } },
        }));
      } else {
        res.writeHead(404); res.end();
      }
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const port = (server.address() as { port: number }).port;
    writeFileSync(join(cwd, 'agent-health.config.ts'), `export default ${JSON.stringify({
      extends: false,
      server: { port, reuseExistingServer: true },
      agents: [{ key: 'stub', name: 'Stub', endpoint: 'http://unused', enabled: true,
        connectorConfig: { model: 'stub-model' } }],
    })};`);
  });

  afterAll(async () => {
    await new Promise<void>((done) => server.close(() => done()));
    rmSync(cwd, { recursive: true, force: true });
  });

  it.each([
    ['passed', 1, 0, 0, 0],
    ['failed', 0, 1, 0, 1],
    [undefined, 0, 0, 1, 1],
  ])('verdict %s produces an honest summary and exit code', async (status, passed, failed, errored, code) => {
    verdict = status;
    const result = await new Promise<{ code: number | null; output: string }>((done, reject) => {
      const child = spawn(process.execPath, [join(root, 'cli/dist/index.js'), 'benchmark', '-t', 'summary-case', '-a', 'stub'], {
        cwd, env: { ...process.env, CI: '', NO_COLOR: '1' },
      });
      let output = '';
      child.stdout.on('data', data => { output += data; });
      child.stderr.on('data', data => { output += data; });
      child.on('error', reject);
      child.on('exit', code => done({ code, output }));
    });
    expect(result.output).toContain(`Passed: ${passed}`);
    expect(result.output).toContain(`Failed: ${failed}`);
    expect(result.output).toContain(`Errored: ${errored}`);
    expect(result.code).toBe(code);
  });
});
