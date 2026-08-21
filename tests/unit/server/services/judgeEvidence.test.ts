/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { buildJudgeEvidence, removeJudgeEvidence } from '@/server/services/judgeEvidence';
import { createEvidenceJudgeExtension } from '@/server/services/evidenceJudgeTools';

const request: any = {
  runId: 'run/full:1',
  trajectory: [
    { id: '1', timestamp: 1, type: 'action', content: 'call', toolName: 'read', toolArgs: { path: 'README.md' } },
    { id: '2', timestamp: 2, type: 'tool_result', content: 'x'.repeat(60_000), toolOutput: 'x'.repeat(60_000) },
  ],
  expectedOutcomes: ['enumerates tools', 'does not modify files'],
  evidenceContext: { prompt: 'inspect without writes', agentKey: 'example', timings: { agentDurationMs: 42 } },
};

afterEach(() => {
  (global.fetch as any) = undefined;
});

describe('judge evidence bundle', () => {
  it('writes the full untruncated trajectory, per-step files, and read-only evidence', async () => {
    (global as any).fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ spans: [], logs: [] }) });
    const bundle = await buildJudgeEvidence(request, 'http://localhost:4001');
    try {
      const trajectory = JSON.parse(await fs.readFile(path.join(bundle.evidenceDir, 'trajectory.json'), 'utf8'));
      expect(trajectory[1].content).toHaveLength(60_000);
      expect(await fs.readFile(path.join(bundle.evidenceDir, 'trajectory.ndjson'), 'utf8')).toContain('"toolOutput":"xxx');
      expect(bundle.files).toEqual(expect.arrayContaining([
        'evidence/testcase.json',
        'evidence/run.json',
        'evidence/steps/001-action.json',
        'evidence/steps/002-tool_result.json',
        'scratch/',
      ]));
      expect(bundle.files).not.toContain('evidence/spans.ndjson');
      expect((await fs.stat(bundle.evidenceDir)).mode & 0o777).toBe(0o555);
      expect((await fs.stat(bundle.scratchDir)).mode & 0o777).toBe(0o755);
    } finally {
      await removeJudgeEvidence(bundle);
    }
    await expect(fs.stat(bundle.rootDir)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('writes spans/logs only when returned by the shared trace fetch', async () => {
    (global as any).fetch = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ spans: [{ spanId: 's1' }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ logs: [{ message: 'ok' }] }) });
    const bundle = await buildJudgeEvidence(request, 'http://localhost:4001');
    try {
      expect(await fs.readFile(path.join(bundle.evidenceDir, 'spans.ndjson'), 'utf8')).toContain('"spanId":"s1"');
      expect(await fs.readFile(path.join(bundle.evidenceDir, 'logs.ndjson'), 'utf8')).toContain('"message":"ok"');
    } finally { await removeJudgeEvidence(bundle); }
  });

  it('copies a recorded workspace without dereferencing symlinks', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'judge-workspace-'));
    await fs.writeFile(path.join(workspace, 'real.txt'), 'real');
    await fs.symlink('/etc/passwd', path.join(workspace, 'link'));
    (global as any).fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ spans: [], logs: [] }) });
    const bundle = await buildJudgeEvidence({ ...request, evidenceContext: { ...request.evidenceContext, workspaceDir: workspace } }, 'http://localhost:4001');
    try {
      expect(await fs.readFile(path.join(bundle.evidenceDir, 'workspace', 'real.txt'), 'utf8')).toBe('real');
      await expect(fs.lstat(path.join(bundle.evidenceDir, 'workspace', 'link'))).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await removeJudgeEvidence(bundle);
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });
});

describe('evidence bash pi extension', () => {
  it('registers bash and returns stdout/stderr plus exit semantics', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'evidence-tool-'));
    await fs.mkdir(path.join(root, 'evidence'));
    await fs.mkdir(path.join(root, 'scratch'));
    await fs.writeFile(path.join(root, 'evidence', 'a'), 'hello\n');
    const tools = new Map<string, any>();
    createEvidenceJudgeExtension(root)({ registerTool: (tool: any) => tools.set(tool.name, tool) });
    expect([...tools.keys()]).toEqual(['bash']);
    expect((await tools.get('bash').execute('1', { command: 'cat evidence/a' })).content[0].text).toBe('hello\n[exit 0]');
    expect((await tools.get('bash').execute('2', { command: 'cat /etc/passwd' })).content[0].text).toMatch(/outside judgment directory[\s\S]*\[exit 2\]/);
    await fs.rm(root, { recursive: true, force: true });
  });
});
