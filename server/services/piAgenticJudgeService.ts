/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pi Agentic Trace Judge (RFC 004 §4.4, #244).
 *
 * An LLM judge that can verify its claims against the run's REAL OTel
 * spans/logs — not just the trajectory text — by driving the pi agent with
 * a restricted, read-only, run-scoped trace-tool pack
 * ([server/pi/extensions/trace-judge.ts]). We reuse pi's tool-calling agent
 * runtime rather than building a bespoke harness; this service only wires
 * up the spawn (extension + run id env + a tool-using system prompt) and
 * parses the verdict.
 */

import { buildEvaluationPrompt, JudgeRequest, JudgeResponse } from '@/server/services/bedrockService';
import { spawnPi, parsePiJudgeJson, parsePiError } from '@/server/services/piJudgeService';
import { getTraceJudgeExtensionPath } from '@/server/services/traceJudgeExtensionPath';
import { readEnv } from '@/lib/envCompat';
import { debug } from '@/lib/debug';

/**
 * Resolve the shipped trace-judge extension relative to THIS package (not the
 * server's `process.cwd()`), so the agent judge works when the server runs
 * from a consumer project directory. See `traceJudgeExtensionPath.ts`.
 */
const TRACE_JUDGE_EXTENSION = getTraceJudgeExtensionPath();

/**
 * System prompt that tells the judge it has real trace/log access and
 * should use it to ground its verdict. Reuses the same JSON output contract
 * the other pi/Bedrock judges emit so parsing is identical.
 */
const AGENTIC_TRACE_JUDGE_SYSTEM_PROMPT = `You are an expert evaluator for observability and Root Cause Analysis (RCA) agents.

You are an AGENTIC judge: in addition to the trajectory shown in the prompt, you have READ-ONLY tools that return the REAL OpenTelemetry spans and logs for the exact run you are judging:
  - query_spans({ nameFilter? }): the run's actual spans (tool calls, token usage, latency, gen_ai.* attributes)
  - query_logs({ query? }): the run's correlated logs (evidence for/against a root cause)

These tools are hard-scoped to this single run; you cannot query other runs. PREFER verifying claims against this real data instead of trusting the trajectory narrative. For example: before accepting "the agent called search_logs", confirm a matching span exists; before accepting a budget claim, check real token usage; before accepting a root-cause claim, look for supporting log evidence.

When you are done investigating, respond with ONLY a JSON object (no prose, optionally fenced in \`\`\`json):
{
  "pass_fail_status": "passed" | "failed",
  "accuracy": <0-100>,
  "reasoning": "<concise explanation grounded in what the tools showed>",
  "metrics": { "faithfulness": <0-100>, "latency_score": <0-100>, "trajectory_alignment_score": <0-100> },
  "improvement_strategies": []
}`;

/**
 * Evaluate a trajectory with the pi agentic trace judge.
 *
 * Requires `request.runId` so the trace tools can scope to the run. When no
 * runId is present we still run (the tools simply report "no run id"), so a
 * caller that selects this provider without trace correlation degrades to a
 * trajectory-only judgement rather than failing.
 */
export async function evaluateWithPiAgenticTrace(
  request: JudgeRequest
): Promise<JudgeResponse> {
  const { trajectory, expectedOutcomes, expectedTrajectory, logs, runId } = request;

  debug('PiAgenticJudge', '========== PI AGENTIC TRACE JUDGE ==========');
  debug('PiAgenticJudge', 'runId:', runId ?? '(none)', 'trajectory steps:', trajectory.length);

  const userPrompt = buildEvaluationPrompt(trajectory, expectedOutcomes, expectedTrajectory, logs);
  const startTime = Date.now();

  const raw = await spawnPi(userPrompt, AGENTIC_TRACE_JUDGE_SYSTEM_PROMPT, {
    omitBasePack: true,
    extraExtensions: [TRACE_JUDGE_EXTENSION],
    extraEnv: {
      // The trace tools read these. runId is the scoping invariant.
      ...(runId ? { AH_JUDGE_RUN_ID: runId } : {}),
      AH_JUDGE_SERVER_URL:
        process.env.AH_JUDGE_SERVER_URL ||
        `http://localhost:${readEnv('AH_PORT', 'AGENT_HEALTH_PORT') || '4001'}`,
    },
  });
  const duration = Date.now() - startTime;

  const parsed = parsePiJudgeJson(raw);
  debug('PiAgenticJudge', 'Pass/Fail:', parsed.passFailStatus, 'in', duration, 'ms');
  return { ...parsed, duration };
}

export { parsePiError as parsePiAgenticError };
