/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/** Real unified route -> runner -> subprocess overlay -> file storage.
 * Only config and the external judge are stubbed. No live/shared data is used.
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { FileStorageModule } from '@/server/adapters/file/StorageModule';

let mockRoot: string;
let mockStorage: FileStorageModule;
jest.mock('@/server/adapters/index', () => ({ getStorageModule: () => mockStorage }));
jest.mock('@/lib/config/index', () => ({
  loadConfigSync: () => ({
    agents: [{ key: 'treatment-agent', name: 'Treatment Agent', endpoint: process.execPath,
      connectorType: 'subprocess', useTraces: false,
      connectorConfig: { args: [join(mockRoot, 'agent.cjs')], workingDir: join(mockRoot, 'fixture'), timeout: 10000 },
    }],
    models: { model: { model_id: 'model' } },
  }),
}));
jest.mock('@/lib/constants', () => ({ DEFAULT_CONFIG: { agents: [], models: { model: { model_id: 'model' } } } }));
jest.mock('@/server/services/customAgentStore', () => ({ getCustomAgents: () => [] }));
jest.mock('@/services/evaluation/bedrockJudge', () => ({
  callBedrockJudge: jest.fn(async () => ({ passFailStatus: 'passed', metrics: { accuracy: 100 },
    llmJudgeReasoning: 'test judge', improvementStrategies: [], judgeDurationMs: 1 })),
  simulateBedrockJudge: jest.fn(),
}));

import router from '@/server/routes/storage/evaluationRuns';
const request = require('supertest');

describe('treatments through the file-backed unified API', () => {
  beforeEach(() => {
    mockRoot = mkdtempSync(join(tmpdir(), 'ah-treatment-route-'));
    mockStorage = new FileStorageModule(join(mockRoot, 'data'));
    mkdirSync(join(mockRoot, 'fixture'));
    writeFileSync(join(mockRoot, 'fixture', 'mode.txt'), 'bare');
    writeFileSync(join(mockRoot, 'agent.cjs'), "process.stdin.resume();process.stdin.on('end',()=>console.log(require('fs').readFileSync('mode.txt','utf8')));\n");
  });
  afterEach(() => rmSync(mockRoot, { recursive: true, force: true }));

  it('persists two arms, stable hashes within each arm, unique trials, and actual overlay outputs', async () => {
    const app = express();
    app.use(express.json());
    app.use(router);
    const tc = await mockStorage.testCases.create({ name: 'treatment-case', initialPrompt: 'read mode', expectedOutcomes: ['reads mode'], labels: [] } as any);
    const bench = await mockStorage.benchmarks.create({ name: 'treatment-benchmark', testCaseIds: [tc.id] } as any);
    const hashes: string[] = [];
    const trialIds: string[] = [];
    for (const arm of ['bare', 'overlay']) {
      for (let trial = 1; trial <= 2; trial++) {
        const trialId = `${arm}-${trial}`;
        const response = await request(app).post('/api/storage/evaluation-runs').send({
          name: `${arm} ${trial}`, agentKey: 'treatment-agent', modelId: 'model', benchmarkId: bench.id,
          sources: [{ type: 'test-case-ids', ids: [tc.id] }], trialId,
          treatmentConfig: { label: arm, config: arm === 'bare' ? {} : { overlays: { files: { 'mode.txt': 'overlay' } } } },
        }).expect(200);
        const events = response.text.split('\n').filter((line: string) => line.startsWith('data: '))
          .map((line: string) => JSON.parse(line.slice(6)));
        expect(events.some((event: any) => event.error)).toBe(false);
        const started = events.find((event: any) => event.runId && event.testCases);
        const run = (await mockStorage.evaluationRuns.getById(started.runId))!;
        expect(run.status).toBe('completed');
        expect(run.treatment?.label).toBe(arm);
        expect(run.trialId).toBe(trialId);
        hashes.push(run.treatment!.configHash);
        trialIds.push(run.trialId!);
        const report = (await mockStorage.runs.getById(run.results[tc.id].reportId))!;
        expect(report.treatment).toEqual(run.treatment);
        expect(report.trialId).toBe(trialId);
        expect(report.trajectory.some(step => step.content.trim() === arm)).toBe(true);
      }
    }
    expect(hashes[0]).toBe(hashes[1]);
    expect(hashes[2]).toBe(hashes[3]);
    expect(hashes[0]).not.toBe(hashes[2]);
    expect(new Set(trialIds).size).toBe(4);
    const persistedBenchmark = (await mockStorage.benchmarks.getById(bench.id))!;
    expect(persistedBenchmark.runs).toHaveLength(4);
    expect(persistedBenchmark.runs.map(run => run.trialId).sort()).toEqual(trialIds.sort());
    expect(readFileSync(join(mockRoot, 'fixture', 'mode.txt'), 'utf8')).toBe('bare');
  }, 60000); // Four real subprocesses plus durable writes on slower file backends.
});
