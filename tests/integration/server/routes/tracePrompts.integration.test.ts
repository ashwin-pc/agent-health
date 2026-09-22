/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */
import express from 'express';
import request from 'supertest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import tracesRouter from '@/server/routes/traces';
import { FileObservabilityModule } from '@/server/adapters/observability/FileObservabilityModule';
import { OpenSearchObservabilityModule } from '@/server/adapters/observability/OpenSearchObservabilityModule';
import { getObservabilityModule } from '@/server/services/observabilityClient';
import { resolveObservabilityConfig } from '@/server/middleware/dataSourceConfig';
import type { Span } from '@/types';

jest.mock('@/server/services/observabilityClient', () => ({ getObservabilityModule: jest.fn() }));
jest.mock('@/server/middleware/dataSourceConfig', () => ({ resolveObservabilityConfig: jest.fn() }));

it.each(['file', 'opensearch'])('POST /api/traces carries bounded root prompts through the %s adapter', async backend => {
  const dir = await mkdtemp(join(tmpdir(), 'ah-trace-prompts-'));
  try {
    const startTime = new Date().toISOString();
    const base = { startTime, endTime: startTime, status: 'OK' as const };
    const spans: Span[] = [
      { ...base, traceId: 'plain', spanId: 'root', name: 'invoke_agent', attributes: { 'gen_ai.prompt': 'x'.repeat(300) } },
      { ...base, traceId: 'fallback', spanId: 'root', name: 'invoke_agent', attributes: { 'gen_ai.input.messages': JSON.stringify([{ role: 'user', parts: [{ type: 'text', content: 'Fallback prompt' }] }]) } },
      { ...base, traceId: 'missing', spanId: 'root', name: 'invoke_agent', attributes: {} },
      { ...base, traceId: 'missing', spanId: 'child', parentSpanId: 'root', name: 'chat', attributes: { 'gen_ai.prompt': 'Child context must not leak into the list' } },
    ];
    if (backend === 'file') {
      const module = new FileObservabilityModule(dir);
      await module.ingest(spans);
      (getObservabilityModule as jest.Mock).mockReturnValue(module);
      (resolveObservabilityConfig as jest.Mock).mockReturnValue(null);
    } else {
      const client = { search: jest.fn().mockResolvedValue({ body: { hits: { hits: spans.map(s => ({ _source: s })), total: { value: spans.length } } } }) };
      (getObservabilityModule as jest.Mock).mockReturnValue(new OpenSearchObservabilityModule(client as any, { traces: 'traces', logs: 'logs', metrics: 'metrics' }));
      (resolveObservabilityConfig as jest.Mock).mockReturnValue({ endpoint: 'http://unused.invalid' });
    }
    const app = express();
    app.use(express.json(), tracesRouter);
    const response = await request(app).post('/api/traces').send({ startTime: Date.now() - 60000, endTime: Date.now() + 60000 });
    expect(response.status).toBe(200);
    expect(response.body.backend).toBe(backend);
    expect(response.body.traces).toEqual(expect.arrayContaining([
      { traceId: 'plain', rootSpanName: 'invoke_agent', prompt: 'x'.repeat(199) + '…' },
      { traceId: 'fallback', rootSpanName: 'invoke_agent', prompt: 'Fallback prompt' },
      { traceId: 'missing', rootSpanName: 'invoke_agent', prompt: '' },
    ]));
    expect(response.body.spans.find((s: Span) => s.traceId === 'plain').attributes['gen_ai.prompt']).toHaveLength(300);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
