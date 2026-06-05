/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `judge()` — LLM-judge matcher, callable from inside a test body.
 *
 * Two ergonomic forms:
 *
 *   await judge(result, 'identifies the failing dependency');         // single claim
 *   await judge(result.trajectory, ['claim 1', 'claim 2']);            // legacy form
 *
 * Per-call options:
 *
 *   await judge(result, claim, { evaluatorId: 'system:cp-oncall' });
 *   await judge(result, claim, { model: 'claude-sonnet' });
 *
 * On evaluation, `judge()` records a MatcherResult and returns a
 * {@link Verdict} **without throwing** (RFC 004 §4.8). A failing
 * `gate`-role verdict still fails the test (the runner inspects the
 * recorded results), but the body keeps running so every signal is
 * collected. To hard-stop the body on a bad verdict, call
 * `(await judge(...)).orThrow()` or assert `expect(verdict).toPass()`.
 *
 * Two roles:
 *   - `judge(result, claim)`         — gate: a failing verdict fails the test.
 *   - `judge.observe(result, claim)` — observe: feeds score + insights only,
 *                                       never fails the test.
 *
 * Calls the Agent Health server's /api/judge endpoint with the same
 * payload shape (`{ trajectory, expectedOutcomes, modelId, evaluatorId }`)
 * the UI "Run Test" path uses, so SDK and UI runs are scored by the same
 * judge prompt and provider routing.
 *
 * Run-level evaluator default: the runner injects a bound version of
 * `judge` into `TestFixtures` via `bindJudge(run.evaluatorId)`. Code
 * that destructures `judge` from the fixture (`async ({ judge }) => ...`)
 * automatically picks up the run's evaluator with no per-call argument.
 * Code that imports `judge` from the package gets the unbound version
 * and must pass `evaluatorId` explicitly.
 */

import type { TrajectoryStep } from '@/types';
import { recordVerdict } from '../matchers/session.js';
import { readEnv } from '../envCompat.js';

/** Whether a judge signal gates the test verdict or is observational only. */
export type JudgeRole = 'gate' | 'observe';

/**
 * The result of a `judge()` call. Carries the verdict data plus a few
 * convenience flags and an explicit hard-stop escape hatch. Returned
 * (never thrown) so the body can collect multiple verdicts; the recorded
 * MatcherResult is what actually gates the test.
 *
 * Backward-compatible with the old `JudgeVerdict` (same
 * `passFailStatus`/`accuracy`/`reasoning` fields).
 */
export interface Verdict {
  passFailStatus: 'passed' | 'failed';
  /** Headline accuracy on the [0, 100] interval. */
  accuracy: number;
  /** Normalised score on the [0, 1] interval (`accuracy / 100`). */
  score: number;
  /** Free-form judge reasoning. */
  reasoning: string;
  /** Convenience: `passFailStatus === 'passed'`. */
  pass: boolean;
  /** Role this verdict was produced with (`gate` or `observe`). */
  role: JudgeRole;
  /** True when the judge was skipped (no LLM call was made). */
  skipped: boolean;
  /** True when the judge could not run at all (endpoint error). */
  errored: boolean;
  /** Underlying error message when `errored` is true. */
  errorMessage?: string;
  /**
   * Hard-stop: throw if the verdict did not pass. A no-op for passing,
   * skipped verdicts. Returns the verdict so it can be chained:
   *   const v = (await judge(result, claim)).orThrow();
   */
  orThrow(): Verdict;
}

/** @deprecated Use {@link Verdict}. Retained as a structural alias. */
export type JudgeVerdict = Verdict;

/**
 * Per-call options for the SDK `judge()` matcher. Mirrors the relevant
 * fields of the `/api/judge` request body so SDK runs and UI runs use
 * the same judge prompt + evaluator + provider routing.
 */
export interface JudgeOptions {
  /**
   * Override the agent-health server URL. Defaults to
   * `http://localhost:${AGENT_HEALTH_PORT ?? 4001}`.
   */
  serverUrl?: string;
  /**
   * Override the judge model. Forwarded as `modelId` on the request body;
   * the server resolves it through `config.models[modelId]` exactly as it
   * does for UI runs.
   */
  model?: string;
  /**
   * Stored evaluator id (system or user). Forwarded as `evaluatorId` on
   * the request body. The server resolves system evaluators via
   * `getSystemEvaluatorById(...)` and user evaluators via
   * `storage.evaluators.getById(...)` — identical to the UI path. Falls
   * back to the default evaluator when omitted on both call and bind.
   */
  evaluatorId?: string;
}

let judgeCalledInCurrentEval = false;

export function wasJudgeCalled(): boolean {
  return judgeCalledInCurrentEval;
}

export function resetJudgeFlag(): void {
  judgeCalledInCurrentEval = false;
}

interface ResultLike {
  trajectory?: TrajectoryStep[];
  finalResponse?: () => string;
  agentOutput?: string;
}

function isTrajectory(x: unknown): x is TrajectoryStep[] {
  return Array.isArray(x);
}

function isResultLike(x: unknown): x is ResultLike {
  return typeof x === 'object' && x !== null && 'trajectory' in (x as object);
}

/**
 * Build a {@link Verdict} object with the `orThrow()` escape hatch attached.
 */
function makeVerdict(v: Omit<Verdict, 'orThrow' | 'pass' | 'score'> & { score?: number }): Verdict {
  const verdict: Verdict = {
    ...v,
    pass: v.passFailStatus === 'passed',
    score: v.score ?? (typeof v.accuracy === 'number' ? v.accuracy / 100 : 0),
    orThrow() {
      // Passing or skipped verdicts never throw. Failed/errored ones do.
      if (this.pass || this.skipped) return this;
      const label = this.errored ? 'errored' : 'FAILED';
      throw new Error(
        `LLM Judge: ${label} (accuracy: ${this.accuracy})\n${this.errorMessage ?? this.reasoning}`
      );
    },
  };
  return verdict;
}

/**
 * The callable `judge` surface: a function (gate role) with an `.observe`
 * method (observe role).
 */
export interface JudgeFn {
  (
    resultOrTrajectory: ResultLike | TrajectoryStep[],
    claimOrClaims: string | string[],
    options?: JudgeOptions
  ): Promise<Verdict>;
  /**
   * Observational judge: records the verdict for score + insights but does
   * NOT gate the test (a failing observe verdict never fails the run).
   */
  observe(
    resultOrTrajectory: ResultLike | TrajectoryStep[],
    claimOrClaims: string | string[],
    options?: JudgeOptions
  ): Promise<Verdict>;
}

/**
 * Core judge implementation. Records exactly one MatcherResult (carrying
 * `role`) and returns a non-throwing {@link Verdict}.
 */
async function runJudge(
  resultOrTrajectory: ResultLike | TrajectoryStep[],
  claimOrClaims: string | string[],
  options: JudgeOptions | undefined,
  role: JudgeRole
): Promise<Verdict> {
  judgeCalledInCurrentEval = true;

  const trajectory = isTrajectory(resultOrTrajectory)
    ? resultOrTrajectory
    : (isResultLike(resultOrTrajectory) ? resultOrTrajectory.trajectory ?? [] : []);
  const claims = Array.isArray(claimOrClaims) ? claimOrClaims : [claimOrClaims];

  const serverUrl =
    options?.serverUrl ?? `http://localhost:${readEnv('AH_PORT', 'AGENT_HEALTH_PORT') || '4001'}`;

  const description =
    claims.length === 1 ? `judge: ${claims[0]}` : `judge: ${claims.length} claims`;

  // Body shape matches the UI's /api/judge POST exactly: trajectory,
  // expectedOutcomes, expectedTrajectory, optional modelId, optional
  // evaluatorId. The server applies the same evaluator-resolution and
  // provider-routing logic regardless of caller, so SDK and UI runs
  // produce comparable verdicts.
  const requestBody: Record<string, unknown> = {
    trajectory,
    expectedOutcomes: claims,
    expectedTrajectory: [],
  };
  if (options?.model) requestBody.modelId = options.model;
  if (options?.evaluatorId) requestBody.evaluatorId = options.evaluatorId;

  const startedAt = Date.now();
  let response: Response;
  try {
    response = await fetch(`${serverUrl}/api/judge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });
  } catch (err: any) {
    const errMsg = err?.message || String(err);
    // Endpoint unreachable — the judge could not run. This is `errored`,
    // not a clean `pass: false`. The matcher is recorded with errored=true
    // so the run is bucketed as `errored` (excluded from pass-rate).
    recordVerdict({
      description,
      pass: false,
      method: 'llm-judge',
      role,
      errored: true,
      durationMs: Date.now() - startedAt,
      errorMessage: `Judge request failed: ${errMsg}`,
      reasoning: '',
    });
    return makeVerdict({
      passFailStatus: 'failed',
      accuracy: 0,
      reasoning: '',
      role,
      skipped: false,
      errored: true,
      errorMessage: `Judge request failed: ${errMsg}`,
    });
  }

  if (!response.ok) {
    const text = await response.text();
    recordVerdict({
      description,
      pass: false,
      method: 'llm-judge',
      role,
      errored: true,
      durationMs: Date.now() - startedAt,
      errorMessage: `Judge HTTP ${response.status}: ${text}`,
      reasoning: '',
    });
    return makeVerdict({
      passFailStatus: 'failed',
      accuracy: 0,
      reasoning: '',
      role,
      skipped: false,
      errored: true,
      errorMessage: `Judge HTTP ${response.status}: ${text}`,
    });
  }

  const result = (await response.json()) as any;
  const accuracy = result.metrics?.accuracy ?? 0;
  const verdict = makeVerdict({
    passFailStatus: result.passFailStatus ?? 'failed',
    accuracy,
    reasoning: result.llmJudgeReasoning ?? '',
    role,
    skipped: false,
    errored: false,
  });

  // Record once for the overall judge call. `observe`-role failures do
  // not gate the test (the runner filters on role).
  recordVerdict({
    description,
    pass: verdict.pass,
    method: 'llm-judge',
    role,
    durationMs: Date.now() - startedAt,
    score: verdict.score,
    reasoning: verdict.reasoning,
    model: options?.model,
    errorMessage: verdict.passFailStatus === 'failed' ? verdict.reasoning : undefined,
    // Preserve the rest of the judge payload — these were silently
    // dropped before, which made SDK `judge()` calls strictly less
    // informative than the legacy auto-judge path. See MatcherResult.
    ...(Array.isArray(result.improvementStrategies) && result.improvementStrategies.length > 0
      ? { improvementStrategies: result.improvementStrategies }
      : {}),
    ...(result.metrics && typeof result.metrics === 'object'
      ? { judgeMetrics: { ...result.metrics } }
      : {}),
  });

  return verdict;
}

/**
 * Single-claim ergonomic form (gate role).
 * @example
 *   const v = await judge(result, 'identifies the failing dependency');
 *   if (!v.pass) { ... }                       // non-throwing
 *   (await judge(result, claim)).orThrow();      // explicit hard-stop
 *   await judge.observe(result, claim);          // score-only, never gates
 */
export const judge: JudgeFn = Object.assign(
  (
    resultOrTrajectory: ResultLike | TrajectoryStep[],
    claimOrClaims: string | string[],
    options?: JudgeOptions
  ): Promise<Verdict> => runJudge(resultOrTrajectory, claimOrClaims, options, 'gate'),
  {
    observe: (
      resultOrTrajectory: ResultLike | TrajectoryStep[],
      claimOrClaims: string | string[],
      options?: JudgeOptions
    ): Promise<Verdict> => runJudge(resultOrTrajectory, claimOrClaims, options, 'observe'),
  }
);

/**
 * Bind run-level defaults to `judge` and return a callable with the same
 * signature. Used by the SDK runner to inject `run.evaluatorId` (and
 * optionally a default judge model) into the `TestFixtures.judge` slot,
 * so test bodies that destructure `({ judge })` automatically inherit
 * the run's evaluator selection — matching the UI's behaviour where the
 * evaluator picked on the run config applies to every judged test case.
 *
 * Per-call options always win over the bound defaults; pass an empty
 * object (or omit the field) to fall through to the bound value.
 *
 *   const boundJudge = bindJudge({ evaluatorId: run.evaluatorId });
 *   await boundJudge(result, claim);                                  // uses run.evaluatorId
 *   await boundJudge(result, claim, { evaluatorId: 'other' });        // overrides
 *   await boundJudge(result, claim, { evaluatorId: undefined });      // still uses bound default
 */
export function bindJudge(defaults?: {
  evaluatorId?: string;
  model?: string;
  serverUrl?: string;
}): JudgeFn {
  // No defaults set → return the unbound function unchanged. Keeps zero
  // overhead for tests that don't use a run-level evaluator.
  if (!defaults || (!defaults.evaluatorId && !defaults.model && !defaults.serverUrl)) {
    return judge;
  }
  const mergeOptions = (options?: JudgeOptions): JudgeOptions => ({
    // Per-call options win on every field that's actually set. We treat
    // an explicit `undefined` the same as a missing field — callers who
    // want to *clear* a bound default should pass an empty string or
    // call the unbound `judge` directly.
    serverUrl: options?.serverUrl ?? defaults.serverUrl,
    model: options?.model ?? defaults.model,
    evaluatorId: options?.evaluatorId ?? defaults.evaluatorId,
  });
  const bound: JudgeFn = Object.assign(
    (resultOrTrajectory: ResultLike | TrajectoryStep[], claimOrClaims: string | string[], options?: JudgeOptions) =>
      runJudge(resultOrTrajectory, claimOrClaims, mergeOptions(options), 'gate'),
    {
      observe: (resultOrTrajectory: ResultLike | TrajectoryStep[], claimOrClaims: string | string[], options?: JudgeOptions) =>
        runJudge(resultOrTrajectory, claimOrClaims, mergeOptions(options), 'observe'),
    }
  );
  return bound;
}
