/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Agent Trace Judge (RFC 004 §4.4, #244).
 *
 * An LLM judge that verifies its claims against the run's REAL OTel spans/logs
 * — not just the trajectory text — by running pi's agent loop **in-process**
 * (via the pi SDK, `createAgentSession`) with a restricted, read-only,
 * run-scoped trace-tool pack (`query_spans` / `query_logs`).
 *
 * In-process (SDK) rather than spawning the pi CLI: no subprocess, no NDJSON
 * stdout parsing, no extension file, no env-var scoping, no PATH/bin lookup.
 * The tools capture `runId` via closure so the judging model cannot pivot to
 * other runs. pi ships as the optionalDependency `@earendil-works/pi-coding-agent`.
 */

import { buildEvaluationPrompt, JudgeRequest, JudgeResponse } from '@/server/services/bedrockService';
import { parseJudgeResponse } from '@/server/services/judgeResponseParser';
import { buildJudgeDebug } from '@/server/services/judgeDebug';
import { createTraceJudgeExtension } from '@/server/services/traceJudgeTools';
import { createEvidenceJudgeExtension } from '@/server/services/evidenceJudgeTools';
import { buildJudgeEvidence, removeJudgeEvidence } from '@/server/services/judgeEvidence';
import type { PiSdk } from '@/server/services/piSdkTypes';
import { Evaluator } from '@/types';
import { readEnv } from '@/lib/envCompat';
import { debug } from '@/lib/debug';
import { regionInferencePrefix } from '@/lib/bedrockCompat';

/**
 * Default base prompt used when no saved evaluator's `systemPrompt` is provided.
 * The trace-tool addendum is appended to whatever base is in effect (default
 * or saved evaluator) so the agentic-judge contract — the existence and use
 * of `query_spans` / `query_logs` — is preserved regardless of how the user
 * customizes the judge prompt.
 */
const DEFAULT_AGENT_TRACE_JUDGE_BASE_PROMPT = `You are an expert evaluator for observability and Root Cause Analysis (RCA) agents.

When you are done investigating, respond with ONLY a JSON object (no prose, optionally fenced in \`\`\`json):
{
  "pass_fail_status": "passed" | "failed",
  "accuracy": <0-100>,
  "reasoning": "<concise explanation grounded in what the tools showed>",
  "metrics": { "faithfulness": <0-100>, "latency_score": <0-100>, "trajectory_alignment_score": <0-100> },
  "improvement_strategies": []
}`;

/**
 * Trace-tool addendum that's ALWAYS appended to whatever base system prompt
 * is in effect (default or user-saved evaluator). Without this paragraph the
 * judge has no way to know `query_spans` / `query_logs` exist or what they
 * return — the trace-judging contract collapses into trajectory-only
 * judgement. Documenting the tools is structurally separate from "how to
 * judge an RCA agent", which is what the saved evaluator's prompt covers.
 */
const AGENT_TRACE_TOOL_ADDENDUM = `

---

## Complete judgment evidence + restricted tools

The trajectory embedded in the user prompt may be truncated. The files below are complete and untruncated. Use the \`bash\` tool to inspect them; it is a safe in-process interpreter, NOT an operating-system shell.

\`\`\`
./
├── evidence/                  # immutable
│   ├── testcase.json          # original prompt + expectedOutcomes
│   ├── run.json               # run id, agent key, timings, metadata
│   ├── trajectory.json        # FULL trajectory array
│   ├── trajectory.ndjson      # one complete step per line
│   ├── steps/NNN-<type>.json  # one complete step per file
│   ├── spans.ndjson           # only when trace data exists
│   ├── logs.ndjson            # only when trace/log data exists
│   └── workspace/             # symlink-free run-workspace snapshot, when recorded
└── scratch/                   # writable temporary analysis files
\`\`\`

\`evidence/\` is READ-ONLY. Writes/redirections are allowed only under \`scratch/\` (100 MB / 500-file quota). The working directory is fixed at the tree root; \`cd\` is not supported. Every path is realpath-confined to this tree and symlinks are rejected. Output is capped near 50 KB; narrow broad queries.

Available restricted commands: \`cat, ls, find (-name/-type/-maxdepth), grep (-i -v -c -n -l -E -F -r -A -B -C -m), rg, head (-n -c), tail (-n -c), wc (-l -c -w), sort (-r -n -u -t -k), uniq (-c -d), cut (-d -f -c), tr (-d/basic sets), sed (s/pat/repl/flags only), echo, pwd, jq\`. Sequences (\`;\`, \`&&\`, \`||\`), pipelines, quoted arguments, \`<\`, and \`>/>> scratch/...\` are supported. Variables/expansion, command substitution, backticks, globs, subshells, and background \`&\` are rejected.

Worked examples:
- \`jq -r '.[] | select(.type=="action") | .toolName' evidence/trajectory.json | sort | uniq -c\`
- \`grep -n -C 2 'sessions_spawn' evidence/trajectory.ndjson\`
- \`jq -r '.expectedOutcomes[]' evidence/testcase.json\`

The compatible trace tools remain available:
  - query_spans({ nameFilter? }): actual run spans, when a run id/traces exist
  - query_logs({ query? }): correlated logs, when a run id/logs exist

Before returning a verdict, you MUST use restricted \`bash\` to inspect \`evidence/testcase.json\` and the complete trajectory files (at least two focused commands). Trace files/tools may be absent or unavailable. That is NOT a degraded judgment: evaluate fully from the complete trajectory and testcase evidence. The trace tools are hard-scoped to this single run. PREFER real evidence over the narrative. Confirm evidence before crediting a tool call, budget claim, file-safety claim, or root-cause claim.`;

/**
 * Dynamically load the pi SDK (optionalDependency). Throws a clear, actionable
 * error when it isn't installed rather than a raw module-not-found.
 *
 * The specifier is held in a variable (not a string literal) so tsc does NOT
 * statically resolve `@earendil-works/pi-coding-agent` at compile time — the
 * package is optional and may be absent (CI / platforms where its native
 * install scripts fail), and a literal `import()` would make the build require
 * it. The runtime result is cast to the local {@link PiSdk} surface.
 */
async function loadPiSdk(): Promise<PiSdk> {
  const PI_SDK_MODULE = '@earendil-works/pi-coding-agent';
  try {
    return (await import(PI_SDK_MODULE)) as unknown as PiSdk;
  } catch (err: any) {
    throw new Error(
      'Agent judge requires the optional dependency "@earendil-works/pi-coding-agent". ' +
        'Reinstall agent-health without --no-optional, or run `npm i @earendil-works/pi-coding-agent`. ' +
        `(${err?.message ?? String(err)})`
    );
  }
}

/** Strip the Bedrock inference-profile region prefix (us./eu./global./au.). */
function bedrockBaseId(id: string): string {
  return id.replace(/^(us|eu|global|au)\./, '');
}

/**
 * Compose the final system prompt the trace judge will see.
 *
 * Two-layer composition:
 *   1. Base prompt: the saved evaluator's `systemPrompt` (when non-empty),
 *      else the default. This is the surface the user iterates on.
 *   2. {@link AGENT_TRACE_TOOL_ADDENDUM} is ALWAYS appended on top so the
 *      tool-use contract (`query_spans` / `query_logs`) survives any
 *      customization of the base prompt. A regression test pins this
 *      invariant — see piAgenticJudgeService.test.
 *
 * Exported for unit testing; production callers go through
 * {@link evaluateWithPiAgenticTrace}.
 */
export function buildAgentTraceJudgeSystemPrompt(evaluator?: { systemPrompt?: string }): string {
  const baseSystemPrompt =
    evaluator?.systemPrompt && evaluator.systemPrompt.trim().length > 0
      ? evaluator.systemPrompt
      : DEFAULT_AGENT_TRACE_JUDGE_BASE_PROMPT;
  return baseSystemPrompt + AGENT_TRACE_TOOL_ADDENDUM;
}

/**
 * Find the registry model matching the run's configured judge model id.
 *
 * Claude 4.x on Bedrock can only be invoked via an inference profile (a model
 * id prefixed with the region, e.g. `us.`/`global.`), NOT the bare id — the
 * bare id fails with "on-demand throughput isn't supported". So among models
 * sharing the requested base id we prefer, in order: the region-appropriate
 * profile, a `global.` profile, any prefixed profile, then the bare id.
 */
export function findRequestedModel<T extends { provider: string; id: string }>(
  models: T[],
  requestedId?: string
): T | undefined {
  if (!requestedId) return undefined;
  const want = bedrockBaseId(requestedId);
  const candidates = models.filter((m) => bedrockBaseId(m.id) === want);
  if (!candidates.length) return undefined;
  const rp = regionInferencePrefix();
  return (
    candidates.find((m) => m.id.startsWith(rp)) ??
    candidates.find((m) => m.id.startsWith('global.')) ??
    candidates.find((m) => bedrockBaseId(m.id) !== m.id) ?? // any inference-profile variant
    candidates[0]
  );
}

/** Pick a judge model from the available (credentialed) models, preferring a recent Claude. */
export function pickJudgeModel<T extends { provider: string; id: string }>(models: T[]): T | undefined {
  if (!models.length) return undefined;
  const score = (m: T) => {
    const id = m.id.toLowerCase();
    let s = 0;
    if (id.includes('sonnet')) s += 100;
    else if (id.includes('opus')) s += 90;
    else if (id.includes('claude')) s += 50;
    // Prefer an inference-profile (region-prefixed) Claude 4.x; the 4.x bare
    // ids fail on-demand on Bedrock, and the older 3.x models are penalized.
    if (id.includes('-4-5') || id.includes('-4-6')) s += 20;
    else if (id.includes('-4-') || id.includes('sonnet-4') || id.includes('opus-4')) s += 15;
    if (id.includes('claude-3') || id.includes('-3-5') || id.includes('-3-7')) s -= 40;
    // Prefer region/global inference profiles over bare ids (bare 4.x can't run on-demand).
    if (id.startsWith(regionInferencePrefix()) || id.startsWith('global.')) s += 8;
    else if (/^(eu|au|apac)\./.test(id)) s -= 8; // wrong-region profile
    return s;
  };
  return [...models].sort((a, b) => score(b) - score(a))[0];
}

/** Extract the final assistant text (the verdict JSON) from pi session messages. */
export function extractFinalAssistantText(messages: any[]): string {
  let last = '';
  for (const m of messages ?? []) {
    if (m?.role !== 'assistant' || !Array.isArray(m.content)) continue;
    const text = m.content
      .filter((c: any) => c?.type === 'text' && typeof c.text === 'string')
      .map((c: any) => c.text)
      .join('');
    if (text.trim()) last = text;
  }
  return last;
}

/**
 * Evaluate a trajectory with the agent trace judge (in-process pi SDK).
 *
 * The complete trajectory is materialized as immutable evidence before the
 * prompt's compact copy is built. A runId is optional: when absent, trace
 * tools report "no run id", while the restricted evidence tool remains fully
 * functional for trajectory-only judgment.
 *
 * @param request - The judge request; runId is optional trace correlation.
 * @param evaluator - Optional saved evaluator. When provided, its `systemPrompt`
 *   replaces the default base prompt; the trace-tool addendum is ALWAYS
 *   appended on top so the judge knows `query_spans`/`query_logs` exist
 *   regardless of how the user customizes the base prompt. Its
 *   `scoringConfig.metrics` drives dynamic metric extraction in the parsed
 *   response.
 */
export async function evaluateWithPiAgenticTrace(
  request: JudgeRequest,
  evaluator?: Evaluator
): Promise<JudgeResponse> {
  const { trajectory, expectedOutcomes, expectedTrajectory, logs, runId, agents } = request;

  debug('AgentJudge', '========== AGENT TRACE JUDGE (in-process) ==========');
  debug('AgentJudge', 'runId:', runId ?? '(none)', 'trajectory steps:', trajectory.length);
  debug('AgentJudge', 'Evaluator:', evaluator ? `${evaluator.name} (${evaluator.id})` : '(none, using default prompt)');

  const userPrompt = buildEvaluationPrompt(trajectory, expectedOutcomes, expectedTrajectory, logs);
  const serverUrl =
    process.env.AH_JUDGE_SERVER_URL ||
    `http://localhost:${readEnv('AH_PORT', 'AGENT_HEALTH_PORT') || '4001'}`;
  const startTime = Date.now();
  const evidence = await buildJudgeEvidence(request, serverUrl);
  const bashCommands: string[] = [];
  const keepEvidence =
    request.keepEvidence === true ||
    ['1', 'true', 'yes'].includes(String(process.env.AH_JUDGE_KEEP_EVIDENCE ?? '').toLowerCase());
  debug('AgentJudge', 'Evidence directory:', evidence.rootDir);
  debug('AgentJudge', 'Evidence files:', evidence.files);

  try {
    const { createAgentSession, SessionManager, AuthStorage, ModelRegistry, DefaultResourceLoader, getAgentDir } =
      await loadPiSdk();

    const authStorage = AuthStorage.create();
    const modelRegistry = ModelRegistry.create(authStorage);
    const available = await modelRegistry.getAvailable();
    // Prefer the exact model the run is configured to judge with; fall back to a
    // recent Claude from the credentialed models.
    const model = findRequestedModel(available, request.modelId) ?? pickJudgeModel(available);
    if (!model) {
      throw new Error(
        'Agent judge: no model available. Configure a default pi model (e.g. a Bedrock or Anthropic model with valid credentials).'
      );
    }
    debug('AgentJudge', 'model:', `${model.provider}/${model.id}`);

    const systemPrompt = buildAgentTraceJudgeSystemPrompt(evaluator);
    const resourceLoader = new DefaultResourceLoader({
      cwd: evidence.rootDir,
      agentDir: getAgentDir(),
      systemPromptOverride: () => systemPrompt,
      appendSystemPromptOverride: () => [],
      extensionFactories: [
        createTraceJudgeExtension(runId, serverUrl, agents),
        createEvidenceJudgeExtension(evidence.rootDir, {
          onCommand: (command) => {
            bashCommands.push(command);
            debug('AgentJudge', 'restricted bash:', command);
            if (keepEvidence) console.info(`[AgentJudge] restricted bash: ${command}`);
          },
        }),
      ],
      // Full isolation for this HEADLESS in-process session. Only the two
      // inline factories above register tools; all user extensions/built-ins
      // stay disabled.
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
    });
    await resourceLoader.reload();

    const { session } = await createAgentSession({
      model,
      authStorage,
      modelRegistry,
      resourceLoader,
      tools: ['bash', 'query_spans', 'query_logs'],
      sessionManager: SessionManager.inMemory(),
    });

    await session.prompt(userPrompt);
    const finalText = extractFinalAssistantText(session.messages);
    const duration = Date.now() - startTime;
    const parsed = parseJudgeResponse(finalText, { evaluator, duration, source: 'AgentJudge' });
    debug('AgentJudge', 'Pass/Fail:', parsed.passFailStatus, 'in', duration, 'ms');
    const judgeDebug = buildJudgeDebug({
      provider: 'agent',
      modelId: `${model.provider}/${model.id}`,
      evaluatorId: evaluator?.id,
      systemPrompt,
      userPrompt,
    });
    if (judgeDebug) {
      parsed.judgeDebug = {
        ...judgeDebug,
        toolCalls: bashCommands.map((command) => ({ tool: 'bash', command })),
        ...(keepEvidence ? { evidenceDir: evidence.rootDir } : {}),
      };
    }
    return { ...parsed, improvementStrategies: [] };
  } finally {
    if (keepEvidence) {
      console.info(`[AgentJudge] Keeping evidence directory: ${evidence.rootDir}`);
    } else {
      await removeJudgeEvidence(evidence);
    }
  }
}
