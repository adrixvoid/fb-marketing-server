# fb-marketing-server

Private, loopback-only Meta Ads service intended for OpenClaw. The server exposes the OpenAPI contract in [`openapi.yaml`](openapi.yaml), stores local state in SQLite, and keeps runtime keys in macOS Keychain.

> **OpenClaw setup:** this is not an MCP server or a production deployment. It is a native OpenClaw `2026.9.2` plugin that calls this service on `127.0.0.1`. Follow the canonical [local OpenClaw setup guide](docs/openclaw-local-setup.md).

> **Current scope:** the service, OpenClaw plugin, LaunchAgent installer, protected database operations, and fixture-tested phased migration validator are implemented. The real pilot, cutover, observation, rollback exercise, retirement, and Meta portfolio/app provisioning remain operator-run work.

## Prerequisites

- macOS (the runtime uses `/usr/bin/security` and Keychain)
- Node.js `24.19.0` (`.nvmrc`)
- npm `11.17.0`

With `nvm`:

```bash
nvm install
nvm use
npm install --global npm@11.17.0
```

Confirm the exact toolchain before continuing:

```bash
node --version # v24.19.0
npm --version  # 11.17.0
```

## Quick start

```bash
npm ci
npm run build
```

Continue with the [local OpenClaw setup guide](docs/openclaw-local-setup.md) to configure Keychain safely, start in the foreground, verify health, and only then enable optional LaunchAgent persistence. The service listens on `http://127.0.0.1:3000`; the host is fixed to loopback.

### Optional LaunchAgent

The LaunchAgent is a per-user macOS service that starts the local gateway automatically after login, without keeping a terminal open. Its plist lives in `~/Library/LaunchAgents/`, application data in `~/Library/Application Support/fb-marketing-server/`, and private logs in `~/Library/Logs/fb-marketing-server/`; this is local persistence, not a production deployment.

## Configuration

| Setting | Required | Purpose |
|---|---:|---|
| Keychain `openclaw-service-token` | Yes | Random bearer token shared only by the OpenClaw plugin and service. |
| Keychain `openclaw-owner-identity` | Yes | Single approver in `<channel>:<user_id>` form. |
| `PORT` environment variable | No | Listener port; defaults to `3000`. The LaunchAgent intentionally uses the default. |

`HOST` is not configurable: the server always binds to `127.0.0.1`.

On first start, the runtime creates:

- `~/Library/Application Support/fb-marketing-server/state.sqlite`
- Keychain entries for cursor signing and owner-command proofs

The database starts with the schema but no client, account, or Meta credential records. Meta-backed endpoints require the operator provisioning in [`docs/meta-setup.md`](docs/meta-setup.md).

## Verify the environment

Read the token only into the calling process and call the authenticated health endpoint:

```bash
SERVICE_TOKEN="$(security find-generic-password -s fb-marketing-server -a openclaw-service-token -w)"
printf 'header = "Authorization: Bearer %s"\n' "$SERVICE_TOKEN" | \
  curl --config - --fail --silent --show-error --url http://127.0.0.1:3000/health
unset SERVICE_TOKEN
```

Expected shape:

```json
{"status":"ok","time":"<ISO-8601 timestamp>"}
```

Run the full project checks before changing or operating the service:

```bash
npm run generate:check
npm run typecheck
npm test
npm run build
```

## Useful commands

| Command | Purpose |
|---|---|
| `npm run generate` | Regenerate OpenAPI-derived TypeScript artifacts. |
| `npm run generate:check` | Fail if generated contract artifacts are stale. |
| `npm run typecheck` | Type-check without emitting files. |
| `npm test` | Run the Node test suite. |
| `npm run build` | Validate generated artifacts, compile to `dist/`, and copy `openapi.yaml`. |
| `npm start` | Run the compiled server from `dist/`. |
| `npm run service:install` | Build, validate, atomically install, and start the user LaunchAgent. |
| `npm run service:status` | Print `launchd` status. |
| `npm run service:uninstall` | Stop the LaunchAgent and remove only its plist. |
| `npm run db -- backup <absolute-path>` | Create and verify a protected SQLite backup under the private data root. |
| `npm run db -- restore <backup> <new-path>` | Verify and restore into a new file; it never overwrites the live database. |
| `npm run migration:validate -- <manifest> <evidence.jsonl>` | Validate inventory and phased rollout gates without calling Meta. |

## Install the OpenClaw plugin

Use the [local OpenClaw setup guide](docs/openclaw-local-setup.md) for the verified `npm-pack:` install flow, strict plugin configuration, owner allowlist, tool registration checks, trusted attachments, and optional LaunchAgent persistence.

## Troubleshooting

- **Wrong Node or npm version:** run `nvm use`, then verify both versions shown above. `node:sqlite` behavior is validated against the pinned Node release.
- **`Keychain access failed` or missing runtime configuration:** create both Keychain records above and run in the same logged-in user session as the LaunchAgent.
- **Invalid owner identity:** store one channel-scoped value such as `discord:123456`, not a bare user ID.
- **`Invalid PORT`:** use an integer from `1` through `65535`.
- **`EADDRINUSE`:** choose another loopback port, for example `PORT=3001 npm start`, and use that port in the health check.
- **Generated artifact is stale:** run `npm run generate`, review the generated diff, then rerun the checks.
- **Keychain access fails:** run on macOS and allow the current user/session to access the `fb-marketing-server` Keychain items. Do not move secrets into the repository as a workaround.

Logs are under `~/Library/Logs/fb-marketing-server/`. See [`docs/remote-access.md`](docs/remote-access.md) for health, backup/restore, rotation, and private remote-access operations.
