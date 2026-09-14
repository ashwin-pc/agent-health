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

## Harvest and quirks

Harvest polls `GET /api/sessions/:id/status` until recursive settlement, then refetches the transcript. Numeric/string timestamps are preserved. `filesystem-workspace` fixture envelopes are integrity checked; legacy fixture context remains supported.

See [`../README.md`](../README.md) for the shared contract, evidence conventions, and contribution checklist.
