/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Agent Health — Trace Judge extension for Pi.dev (RFC 004 §4.4, #244).
 *
 * Turns the pi agent into an **agentic judge with a restricted tool pack**:
 * instead of grading purely from the trajectory text in the prompt, the
 * judge can query the run's real OpenTelemetry spans and logs to verify
 * claims (tool calls actually happened, token budget, latency, span
 * attributes, log evidence for a root cause).
 *
 * Why pi rather than a bespoke agent loop: pi already provides the
 * tool-calling agent runtime, so we only ship the tools — no harness.
 *
 * **Security / scoping invariant:** every tool is read-only and is hard
 * scoped to a SINGLE run id, taken from the `AH_JUDGE_RUN_ID` env var the
 * judge service injects. The run id is deliberately NOT a tool parameter,
 * so the judging LLM physically cannot pivot to query other runs' data.
 * Tools call back to the Agent Health server's existing read endpoints
 * (`POST /api/traces`, `POST /api/logs`) at `AH_JUDGE_SERVER_URL`.
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

function textResult(obj: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(obj, null, 2) }] };
}

export default function (pi: ExtensionAPI) {
  const runId = process.env.AH_JUDGE_RUN_ID;
  const serverUrl = process.env.AH_JUDGE_SERVER_URL || 'http://localhost:4001';

  // --- Tool: query_spans (read-only, scoped to AH_JUDGE_RUN_ID) ---
  pi.registerTool({
    name: 'query_spans',
    label: 'Query OTel spans for the run under evaluation',
    description:
      "Fetch the OpenTelemetry spans the agent emitted during THIS run (the one " +
      "you're judging). Read-only and hard-scoped to this run — you cannot query " +
      'other runs. Use it to verify claims: which tools were actually invoked and ' +
      'with what arguments, token usage, span durations/latency, and span ' +
      'attributes (gen_ai.*). Prefer this over trusting the trajectory text alone.',
    promptSnippet: 'Query the real OTel spans for the run being judged',
    promptGuidelines: [
      'Use query_spans to confirm a claimed tool call actually happened in the trace',
      'Use query_spans to check real token usage / latency before judging budget claims',
      'Pass nameFilter to narrow to spans whose name contains a substring',
    ],
    parameters: Type.Object({
      nameFilter: Type.Optional(
        Type.String({ description: 'Only return spans whose name contains this substring' })
      ),
    }),
    async execute(_toolCallId: string, params: { nameFilter?: string }) {
      if (!runId) {
        return textResult({ error: 'No run id available — trace tools are disabled for this judge invocation.' });
      }
      try {
        const res = await fetch(`${serverUrl}/api/traces`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ runIds: [runId], size: 500 }),
        });
        if (!res.ok) {
          return textResult({ error: `traces query failed: HTTP ${res.status}` });
        }
        const data: any = await res.json();
        let spans: any[] = Array.isArray(data?.spans) ? data.spans : [];
        if (params.nameFilter) {
          const f = params.nameFilter.toLowerCase();
          spans = spans.filter((s) => String(s?.name ?? '').toLowerCase().includes(f));
        }
        // Trim each span to the fields a judge cares about to keep the
        // tool result compact and prompt-friendly.
        const summary = spans.map((s) => ({
          name: s.name,
          startTime: s.startTime,
          endTime: s.endTime,
          status: s.status,
          attributes: s.attributes,
        }));
        return textResult({ runId, spanCount: summary.length, spans: summary, warning: data?.warning });
      } catch (err: any) {
        return textResult({ error: `traces query error: ${err?.message ?? String(err)}` });
      }
    },
  });

  // --- Tool: query_logs (read-only, scoped to AH_JUDGE_RUN_ID) ---
  pi.registerTool({
    name: 'query_logs',
    label: 'Query logs for the run under evaluation',
    description:
      'Fetch application/OTel logs correlated to THIS run. Read-only and ' +
      'hard-scoped to this run. Use it to find evidence for or against a ' +
      'root-cause claim (error messages, stack traces, status codes).',
    promptSnippet: 'Query the logs for the run being judged',
    promptGuidelines: [
      'Use query_logs to verify a claimed root cause is actually supported by log evidence',
      'Pass a query substring to filter the log lines',
    ],
    parameters: Type.Object({
      query: Type.Optional(Type.String({ description: 'Optional substring/text filter for log lines' })),
    }),
    async execute(_toolCallId: string, params: { query?: string }) {
      if (!runId) {
        return textResult({ error: 'No run id available — trace tools are disabled for this judge invocation.' });
      }
      try {
        const res = await fetch(`${serverUrl}/api/logs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ runId, query: params.query, size: 200 }),
        });
        if (!res.ok) {
          return textResult({ error: `logs query failed: HTTP ${res.status}` });
        }
        const data: any = await res.json();
        return textResult({ runId, logs: data?.logs ?? data });
      } catch (err: any) {
        return textResult({ error: `logs query error: ${err?.message ?? String(err)}` });
      }
    },
  });
}
