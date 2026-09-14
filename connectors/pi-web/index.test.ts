/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PiWebConnector } from './index';

const testCase = {
  id: 'tc-1',
  name: 'pi-web case',
  initialPrompt: 'finish the task',
  context: [],
} as any;

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('PiWebConnector', () => {
  const temporaryPaths: string[] = [];
  afterEach(() => {
    jest.restoreAllMocks();
    temporaryPaths.splice(0).forEach(path => rmSync(path, { recursive: true, force: true }));
  });

  it('materializes named skills in isolated pi workspaces without changing the fixture', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agent-health-pi-web-overlay-'));
    temporaryPaths.push(root);
    const fixturesDir = join(root, 'fixtures');
    const skillsDirectory = join(root, 'skills');
    mkdirSync(join(fixturesDir, 'bare'), { recursive: true });
    mkdirSync(join(skillsDirectory, 'design-doc'), { recursive: true });
    writeFileSync(join(fixturesDir, 'bare', 'source.txt'), 'pinned');
    writeFileSync(join(skillsDirectory, 'design-doc', 'SKILL.md'), 'design skill bytes');
    jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const path = new URL(String(input)).pathname;
      if (path === '/api/new-chat') return jsonResponse({ sessionId: 'session-overlay' });
      if (path.endsWith('/status')) return jsonResponse({ settled: true });
      if (path === '/api/messages') return jsonResponse({ messages: [{ role: 'assistant', text: 'done' }] });
      return jsonResponse({ ok: true });
    });
    const request = {
      testCase: { ...testCase, context: [{ description: 'fixture', value: 'bare', disposition: 'connector' }] },
      modelId: 'model',
      connectorConfig: { fixturesDir, skillsDirectory, settleMs: 0 },
    };
    const connector = new PiWebConnector();
    for (const skills of [[], ['design-doc']]) {
      const result = await connector.execute('http://pi-web.example', {
        ...request, overlays: { skills, files: { 'extra.txt': 'overlay' } },
      }, { type: 'none' });
      const workspace = result.metadata!.workspaceDir;
      temporaryPaths.push(workspace);
      expect(readFileSync(join(workspace, 'source.txt'), 'utf8')).toBe('pinned');
      expect(readFileSync(join(workspace, 'extra.txt'), 'utf8')).toBe('overlay');
      expect(existsSync(join(workspace, '.pi/skills/design-doc/SKILL.md'))).toBe(skills.length > 0);
      expect(result.metadata!.environment.skills).toEqual(skills);
      if (skills.length) expect(readFileSync(join(workspace, '.pi/skills/design-doc/SKILL.md'), 'utf8')).toBe('design skill bytes');
    }
    expect(existsSync(join(fixturesDir, 'bare', '.pi'))).toBe(false);
    expect(existsSync(join(fixturesDir, 'bare', 'extra.txt'))).toBe(false);
    const withSkill = { ...request, overlays: { skills: ['design-doc'] } };
    const before = connector.describeEnvironment(withSkill);
    expect(connector.describeEnvironment(withSkill)).toEqual(before);
    writeFileSync(join(skillsDirectory, 'design-doc', 'SKILL.md'), 'changed bytes');
    expect(connector.describeEnvironment(withSkill)).not.toEqual(before);
  });

  it('rejects unsupported env and invalid skills instead of silently ignoring treatments', () => {
    const connector = new PiWebConnector();
    expect(() => connector.describeEnvironment({ testCase, modelId: 'model', overlays: { env: { MODE: 'test' } } }))
      .toThrow('env overlays are unsupported');
    expect(() => connector.describeEnvironment({ testCase, modelId: 'model', overlays: { skills: ['../escape'] } }))
      .toThrow('Invalid treatment skill name');
    expect(() => connector.describeEnvironment({ testCase, modelId: 'model', overlays: { skills: ['design-doc'] } }))
      .toThrow('skillsDirectory');
  });

  it('builds prompts from prompt-disposition context only', () => {
    const connector = new PiWebConnector();
    const payload = connector.buildPayload({
      testCase: {
        ...testCase,
        context: [
          { description: 'visible', value: 'yes', disposition: 'prompt' },
          { description: 'fixture', value: 'legacy', disposition: 'connector' },
          { description: 'notes', value: 'hidden', disposition: 'documentation' },
        ],
      },
      modelId: 'model',
    });
    expect(payload.message).toContain('### visible\nyes');
    expect(payload.message).not.toContain('legacy');
    expect(payload.message).not.toContain('hidden');
  });

  it('waits for recursive settlement before harvesting and keeps numeric timestamps', async () => {
    const calls: string[] = [];
    jest.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      const path = new URL(url).pathname;
      calls.push(`${init?.method || 'GET'} ${path}`);
      if (path === '/api/new-chat') return jsonResponse({ sessionId: 'session-1' });
      if (path === '/api/sessions/session-1/status') {
        return jsonResponse({
          sessionId: 'session-1',
          state: 'idle',
          settled: true,
          pendingWakeups: 0,
          trackedWorkers: [{ id: 'worker-1', state: 'idle', settled: true }],
        });
      }
      if (path === '/api/messages') {
        return jsonResponse({
          messages: [{ role: 'assistant', text: 'complete', timestamp: '1712345678901' }],
        });
      }
      return jsonResponse({ ok: true });
    });

    const result = await new PiWebConnector().execute(
      'http://pi-web.example',
      {
        testCase,
        modelId: 'model',
        connectorConfig: { timeoutMs: 100, pollIntervalMs: 1, settleMs: 0 },
      },
      { type: 'bearer', token: 'secret' },
    );

    expect(calls.indexOf('GET /api/sessions/session-1/status'))
      .toBeLessThan(calls.indexOf('GET /api/messages'));
    expect(result.trajectory).toEqual([
      expect.objectContaining({ type: 'response', content: 'complete', timestamp: 1712345678901 }),
    ]);
    expect(result.metadata).toEqual(expect.objectContaining({
      sessionId: 'session-1',
      childSessions: ['worker-1'],
      timedOut: false,
    }));
  });

  it('rejects an empty harvest so the runner records an errored report', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const path = new URL(String(input)).pathname;
      if (path === '/api/new-chat') return jsonResponse({ sessionId: 'session-empty' });
      if (path === '/api/sessions/session-empty/status') {
        return jsonResponse({ sessionId: 'session-empty', state: 'idle', settled: true });
      }
      if (path === '/api/messages') return jsonResponse({ messages: [] });
      return jsonResponse({ ok: true });
    });

    await expect(new PiWebConnector().execute(
      'http://pi-web.example',
      {
        testCase,
        modelId: 'model',
        connectorConfig: { timeoutMs: 100, pollIntervalMs: 1, settleMs: 0 },
      },
      { type: 'none' },
    )).rejects.toThrow('settled without any harvestable trajectory steps');
  });

  it('rejects an envelope whose filesystem fixture fails integrity verification', async () => {
    const fixturesDir = mkdtempSync(join(tmpdir(), 'agent-health-pi-web-fixtures-'));
    temporaryPaths.push(fixturesDir);
    mkdirSync(join(fixturesDir, 'workspace'));
    writeFileSync(join(fixturesDir, 'workspace', 'file.txt'), 'actual');

    await expect(new PiWebConnector().execute(
      'http://pi-web.example',
      {
        testCase: {
          ...testCase,
          fixture: {
            type: 'filesystem-workspace',
            ref: 'workspace',
            integrity: `sha256:${'0'.repeat(64)}`,
          },
        },
        modelId: 'model',
        connectorConfig: { fixturesDir },
      },
      { type: 'none' },
    )).rejects.toThrow('Fixture integrity mismatch');
  });
});
