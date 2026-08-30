/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import type { TestCase } from '@/types';
import type { EvalResult, TestFixtures } from '@/lib/testCases/types';
import { emptyTracesAccessor, runInSession } from '@/lib/matchers';
import { expect as ahExpect } from '@/lib/matchers/expect';
import { clearJudgeCache, judge } from '@/lib/testCases/judge';
import {
  compareWorkspaceToManifest,
  compileDeclarativeTestCase,
  deriveMatcherSessionVerdict,
} from '@/services/declarativeCaseCompiler';

function testCase(overrides: Partial<TestCase> = {}): TestCase {
  return {
    id: 'tc-json', name: 'JSON case', description: '', labels: [],
    category: 'RCA', difficulty: 'Easy', currentVersion: 1, versions: [],
    isPromoted: false, createdAt: '', updatedAt: '', initialPrompt: 'run it',
    context: [], expectedOutcomes: ['plain claim'],
    ...overrides,
  } as TestCase;
}

function result(overrides: Partial<EvalResult> = {}): EvalResult {
  const trajectory = [{ type: 'response', content: 'done' }] as any;
  return {
    trajectory,
    agentOutput: 'done',
    finalResponse: () => 'done',
    parsedOutput: () => undefined,
    rawEvents: [],
    runId: 'run-1',
    durationMs: 1,
    ...overrides,
  } as EvalResult;
}

function fixtures(runResult: EvalResult): TestFixtures {
  return {
    result: result(),
    agent: { run: jest.fn(async () => runResult) } as any,
    judge,
    traces: emptyTracesAccessor(),
    expect: ahExpect,
    testInfo: { name: 'JSON case' },
    provisioned: {},
  };
}

describe('declarative case compiler', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    clearJudgeCache();
    delete process.env.AH_SKIP_JUDGE;
  });

  it('maps strings to gates, object roles to observe, and batches all LLM claims into one judge call', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        passFailStatus: 'failed',
        metrics: { accuracy: 50 },
        llmJudgeReasoning: 'one of two passed',
        outcomeResults: [
          { outcome: 'plain claim', pass: true, evidence: 'present in output' },
          { outcome: 'quality score', pass: false, evidence: 'not demonstrated' },
        ],
      }),
    }));
    global.fetch = fetchMock as any;

    const compiled = compileDeclarativeTestCase(testCase({
      expectedOutcomes: [
        'plain claim',
        { outcome: 'quality score', role: 'observe' },
      ],
    }));
    const session = await runInSession(() => compiled(fixtures(result())));

    expect(session.error).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(request.expectedOutcomes).toEqual(['plain claim', 'quality score']);
    expect(session.results).toEqual([
      expect.objectContaining({
        description: 'plain claim', pass: true, method: 'llm-judge', role: 'gate',
        reasoning: 'present in output',
      }),
      expect.objectContaining({
        description: 'quality score', pass: false, method: 'llm-judge', role: 'observe',
        reasoning: 'not demonstrated',
      }),
    ]);
    expect(deriveMatcherSessionVerdict(session.results)).toBe('passed');
  });

  it('maps workspace-diff to a deterministic matcher without invoking the judge', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ah-workspace-diff-'));
    try {
      await mkdir(join(root, 'src'));
      await writeFile(join(root, 'src', 'a.txt'), 'alpha');
      const sha256 = createHash('sha256').update('alpha').digest('hex');
      const compiled = compileDeclarativeTestCase(testCase({
        fixture: {
          payload: { manifest: { tree: [{ path: 'src/a.txt', size: 5, sha256 }] } },
        },
        expectedOutcomes: [
          { outcome: 'workspace remains unchanged', check: 'workspace-diff' },
        ],
      }));
      const judgeBatch = jest.fn();
      const f = fixtures(result({ workspaceDir: root }));
      f.judge = Object.assign(jest.fn(), { observe: jest.fn(), batch: judgeBatch }) as any;
      const session = await runInSession(() => compiled(f));

      expect(session.error).toBeUndefined();
      expect(judgeBatch).not.toHaveBeenCalled();
      expect(session.results).toEqual([
        expect.objectContaining({
          description: 'workspace remains unchanged',
          pass: true,
          method: 'workspace-diff',
          role: 'gate',
        }),
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('reports added, removed, and changed files in workspace diffs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ah-workspace-delta-'));
    try {
      await writeFile(join(root, 'changed.txt'), 'after');
      await writeFile(join(root, 'added.txt'), 'new');
      const diff = await compareWorkspaceToManifest(root, [
        { path: 'changed.txt', size: 6, sha256: createHash('sha256').update('before').digest('hex') },
        { path: 'removed.txt', size: 3, sha256: createHash('sha256').update('old').digest('hex') },
      ]);
      expect(diff.pass).toBe(false);
      expect(diff.reasoning).toContain('added: added.txt');
      expect(diff.reasoning).toContain('removed: removed.txt');
      expect(diff.reasoning).toContain('changed: changed.txt');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('derives verdicts mechanically from gate roles', () => {
    expect(deriveMatcherSessionVerdict([
      { description: 'gate', pass: true, method: 'llm-judge', role: 'gate' },
      { description: 'observation', pass: false, method: 'llm-judge', role: 'observe' },
    ])).toBe('passed');
    expect(deriveMatcherSessionVerdict([
      { description: 'gate', pass: false, method: 'llm-judge', role: 'gate' },
    ])).toBe('failed');
    expect(deriveMatcherSessionVerdict([
      { description: 'judge', pass: false, method: 'llm-judge', role: 'gate', errored: true },
    ])).toBe('errored');
  });
});
