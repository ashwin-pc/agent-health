/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Unit tests for the pi agentic trace judge (RFC 004 §4.4, #244).
 * The pi spawn itself needs the pi CLI (covered by an integration test);
 * here we mock spawnPi and assert the wiring: the restricted trace-tool
 * extension is loaded and the run id is injected as the scoping env var.
 */

jest.mock('@/server/services/piJudgeService', () => ({
  spawnPi: jest.fn(),
  parsePiJudgeJson: jest.requireActual('@/server/services/piJudgeService').parsePiJudgeJson
    ?? ((s: string) => JSON.parse(s)),
  parsePiError: (e: Error) => e.message,
}));

import { evaluateWithPiAgenticTrace } from '@/server/services/piAgenticJudgeService';
import { spawnPi } from '@/server/services/piJudgeService';

const mockSpawnPi = spawnPi as jest.Mock;

const VERDICT = JSON.stringify({
  pass_fail_status: 'passed',
  accuracy: 90,
  reasoning: 'verified via spans',
  metrics: { faithfulness: 88 },
});

describe('evaluateWithPiAgenticTrace', () => {
  beforeEach(() => jest.clearAllMocks());

  it('loads the trace-judge extension and scopes tools to the run id', async () => {
    mockSpawnPi.mockResolvedValue(VERDICT);

    const result = await evaluateWithPiAgenticTrace({
      trajectory: [{ type: 'response', content: 'done' } as any],
      expectedOutcomes: ['identifies the DB outage'],
      runId: 'agent-run-123',
    });

    expect(mockSpawnPi).toHaveBeenCalledTimes(1);
    const [, systemPrompt, opts] = mockSpawnPi.mock.calls[0];
    // System prompt advertises the tools.
    expect(systemPrompt).toMatch(/query_spans/);
    expect(systemPrompt).toMatch(/query_logs/);
    // Trace-judge extension is loaded.
    expect(opts.extraExtensions.some((p: string) => p.endsWith('server/pi/extensions/trace-judge.ts'))).toBe(true);
    // Sample-agent base pack is skipped (it pulls in deps the judge doesn't need).
    expect(opts.omitBasePack).toBe(true);
    // Run id is injected as the scoping env var.
    expect(opts.extraEnv.AH_JUDGE_RUN_ID).toBe('agent-run-123');
    expect(opts.extraEnv.AH_JUDGE_SERVER_URL).toMatch(/^http:\/\//);

    expect(result.passFailStatus).toBe('passed');
    expect(result.metrics.accuracy).toBe(90);
    expect(typeof result.duration).toBe('number');
  });

  it('omits AH_JUDGE_RUN_ID when no runId is supplied (degrades to trajectory-only)', async () => {
    mockSpawnPi.mockResolvedValue(VERDICT);
    await evaluateWithPiAgenticTrace({
      trajectory: [{ type: 'response', content: 'x' } as any],
      expectedOutcomes: ['c'],
    });
    const opts = mockSpawnPi.mock.calls[0][2];
    expect('AH_JUDGE_RUN_ID' in opts.extraEnv).toBe(false);
  });
});
