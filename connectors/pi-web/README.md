# pi-web connector

## Connects to

A real pi-web browser-server session, including recursively spawned worker sessions.

## Configuration

Set `connectorType: 'pi-web'`; `endpoint` is the pi-web base URL. Configure `token` (or `PI_WEB_TOKEN`/bearer auth), `cwd`, optional `model`, `timeoutMs`, `pollIntervalMs`, `settleMs`, `keepSession`, and `fixturesDir`.

## Treatment overlays

Set `connectorConfig.skillsDirectory` to a directory of named skills. A treatment
such as `{"overlays":{"skills":["design-doc"]}}` resolves
`<skillsDirectory>/design-doc/SKILL.md` and copies the skill into the session's
isolated `.pi/skills/design-doc/` before creating the session. Skills must be
names, not absolute paths. Pi discovers these workspace skills normally; the
agent still decides whether to read a skill.

`overlays.files` writes relative paths into the isolated copy, never the source
fixture. The pinned fixture integrity is checked **before** applying overlays.
The environment report records named skills, their content-tree hashes, file
content hashes, and the configured pi-web model. Temporary workspace paths do
not enter the treatment hash. Workspaces are retained with sessions for evidence
inspection. These overlays are additive: they do not disable global pi skills.

`overlays.env` is rejected explicitly because pi-web's session API does not
support per-session environment variables; it is never silently ignored.

## Connector-derived traces

After a non-empty harvest, the connector posts OTLP/JSON to the agent-health
receiver at `POST /v1/traces`. The default base URL is `getBackendUrl()`:
`http://localhost:${AH_PORT}` (legacy `AGENT_HEALTH_PORT`, default `4001`). The
server keeps `AH_PORT` synchronized with its actual listening port. For a remote
receiver, set `connectorConfig.traceBaseUrl`; disable export with
`connectorConfig.emitTraces: false`. No pi-web credentials are forwarded.
Delivery is awaited before returning the harvest, bounded to five seconds, and
failures only warn; the agent result is retained. Enable `useTraces: true` on the
agent to engage trace-aware judging. The embedded receiver stores locally in file
mode; when OpenSearch is configured, point `traceBaseUrl` at an OTLP/JSON collector
instead, because the embedded receiver intentionally does not write local files.

These are **connector-derived**, not native pi instrumentation. Every span carries
`agent_health.trace.source="connector-derived"` and
`agent_health.trace.timing="transcript-bounds"`. The tree contains one
`invoke_agent` root and sibling `chat` and `execute_tool` children. Model, token
usage, tool names, bounded argument summaries (500 characters), and result status
come from harvested messages. Assistant timestamps mark turn starts; the next
message bounds completion. Exact tool starts are used when available; otherwise
the assistant timestamp is an approximate bound. Missing tool results remain
UNSET with zero duration, not invented successes. These durations must not be
interpreted as precise provider latency. Worker activity appears only insofar as
it is present in the harvested parent transcript, not as invented worker spans.

`gen_ai.conversation.id` uses `ConnectorRequest.runId` when supplied, mirrored to
`agent_health.run.id`. The shared `invokeAgent` path currently supplies no run id,
so the connector uses and returns the pi-web session id. Every span also carries
`session.id`, enabling the poller's exact session filter. Deterministic SHA-256
trace and span ids use session id plus transcript message/call index; re-emission
is deduplicated by the file store. Raw events remain unchanged.

## Harvest and quirks

Harvest polls `GET /api/sessions/:id/status` until recursive settlement, then refetches the transcript. Numeric/string timestamps are preserved. `filesystem-workspace` fixture envelopes are integrity checked; legacy fixture context remains supported.

See [`../README.md`](../README.md) for the shared contract, evidence conventions, and contribution checklist.
