# fb-marketing-server

Private, loopback-only Meta Ads service intended for OpenClaw. The server exposes the OpenAPI contract in [`openapi.yaml`](openapi.yaml), stores local state in SQLite, and keeps runtime keys in macOS Keychain.

> **Current scope:** the local server and authenticated health check run today. Meta account provisioning, credential management, campaign mutation execution/reconciliation, and the OpenClaw plugin/owner commands are not implemented yet.

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

# One-time: create the service token without placing it in shell history.
openssl rand -hex 32 | security add-generic-password \
  -s fb-marketing-server -a openclaw-service-token -w

export OPENCLAW_SERVICE_TOKEN="$(security find-generic-password \
  -s fb-marketing-server -a openclaw-service-token -w)"
export OPENCLAW_OWNER_IDENTITY='discord:your-user-id'

npm run build
npm start
```

The service listens on `http://127.0.0.1:3000`. Keep it private; the host is fixed to loopback.

## Configuration

| Variable | Required | Purpose |
|---|---:|---|
| `OPENCLAW_SERVICE_TOKEN` | Yes | Bearer token shared only by OpenClaw and this service. Use a cryptographically random value. |
| `OPENCLAW_OWNER_IDENTITY` | Yes | The single approver in `<channel>:<user_id>` form, for example `discord:123456`. |
| `PORT` | No | Listener port. Defaults to `3000`; valid range is `1`–`65535`. |

`HOST` is not configurable: the server always binds to `127.0.0.1`.

On first start, the runtime creates:

- `~/Library/Application Support/fb-marketing-server/state.sqlite`
- Keychain entries for cursor signing and owner-command proofs

The database starts with the schema but no client, account, or Meta credential records. This repository currently has no provisioning or credential-management command, so Meta-backed endpoints cannot return live data from a fresh checkout. [`docs/meta-setup.md`](docs/meta-setup.md) records the planned administrative setup; it is not a runnable setup procedure.

## Verify the environment

In another terminal, load the same service token and call the authenticated health endpoint:

```bash
export OPENCLAW_SERVICE_TOKEN="$(security find-generic-password \
  -s fb-marketing-server -a openclaw-service-token -w)"

printf 'header = "Authorization: Bearer %s"\n' "$OPENCLAW_SERVICE_TOKEN" | \
  curl --config - -fsS http://127.0.0.1:3000/health
```

Expected shape:

```json
{"status":"ok","time":"<ISO-8601 timestamp>"}
```

Run the full project checks before changing or deploying the service:

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

## Troubleshooting

- **Wrong Node or npm version:** run `nvm use`, then verify both versions shown above. `node:sqlite` behavior is validated against the pinned Node release.
- **`OPENCLAW_SERVICE_TOKEN is required`:** load the token into the process environment before `npm start`.
- **`Invalid OPENCLAW_OWNER_IDENTITY`:** use one channel-scoped value such as `discord:123456`, not a bare user ID.
- **`Invalid PORT`:** use an integer from `1` through `65535`.
- **`EADDRINUSE`:** choose another loopback port, for example `PORT=3001 npm start`, and use that port in the health check.
- **Generated artifact is stale:** run `npm run generate`, review the generated diff, then rerun the checks.
- **Keychain access fails:** run on macOS and allow the current user/session to access the `fb-marketing-server` Keychain items. Do not move secrets into the repository as a workaround.

See [`docs/architecture.md`](docs/architecture.md) for the trust boundaries and [`docs/remote-access.md`](docs/remote-access.md) for the planned OpenClaw/Tailscale topology.
