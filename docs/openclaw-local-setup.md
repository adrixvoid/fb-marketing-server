# Use fb-marketing-server with OpenClaw locally

This integration is **not an MCP server**. It is an OpenClaw `2026.9.2` native plugin that registers nine scope-aware model tools and two deterministic owner-only commands. The plugin calls the Fastify API over `http://127.0.0.1:3000`; neither API is intended for public or production deployment.

## 1. Architecture and trust boundary

```text
trusted chat channel
  |  inbound message/attachment context
  v
OpenClaw 2026.9.2 Gateway
  |-- model dispatch: nine registered tools
  |-- command dispatch: /approve-ad and /reject-ad (owner only)
  |
  |  HTTP + service bearer, loopback only
  v
fb-marketing-server (Fastify on 127.0.0.1:3000)
  |-- SQLite state and private staged media
  |-- macOS Keychain secret provider
  `-- Meta Graph/Marketing API v26.0 (outbound only when a tool needs Meta)
```

The trust boundary is the local Mac user session. OpenClaw receives chat identity and attachments, but the model never receives the service bearer, owner-proof key, Meta token, App Secret, local attachment path, or approval capability. The plugin rejects non-loopback base URLs, redirects, oversized responses, and responses with the wrong request correlation ID.

## 2. Prerequisites

- macOS with an unlocked login Keychain for the same user that runs both processes.
- Node.js `24.19.0`, pinned by `.nvmrc` and `package.json`.
- npm `11.17.0`, pinned by `package.json`.
- OpenClaw `2026.9.2`. The plugin package and lockfile pin this exact peer/dev version.
- A trusted OpenClaw channel with one known owner identity in exact `<channel>:<user_id>` form.

From the repository root:

```bash
nvm install
nvm use
npm install --global npm@11.17.0
node --version # v24.19.0
npm --version  # 11.17.0
openclaw --version # OpenClaw 2026.9.2
npm ci
npm run build
```

## 3. Configure Keychain records

All runtime records use Keychain service `fb-marketing-server`.

| Account | Content | Created by | Used by |
|---|---|---|---|
| `openclaw-service-token` | Random bearer shared by the plugin and local Fastify service | Operator, before first start | Server and plugin |
| `openclaw-owner-identity` | Exact non-secret `<channel>:<user_id>` owner identity | Operator, before first start | Server approval validation |
| `owner-proof-hmac-key` | Random 32-byte base64 HMAC key | Server automatically on first start | Server and deterministic plugin commands |
| `cursor-hmac-key` | Random 32-byte base64 cursor key | Server automatically on first start | Server only |
| `<credential-key-ref>` | Random 32-byte base64 AES key for a scoped Meta credential envelope | Trusted out-of-band provisioning | Server only |

Create or rotate the service bearer without placing it in argv, shell history, or a file:

```bash
openssl rand -base64 32 | /usr/bin/security add-generic-password -U \
  -s fb-marketing-server -a openclaw-service-token -w
```

Enter the owner identity through a private prompt. Replace the prompt input with the exact identity reported by the configured channel, such as `discord:<user_id>`; do not use a bare user ID.

```bash
read -r -s "OWNER_IDENTITY?Owner identity (<channel>:<user_id>): "
printf '\n'
printf '%s\n' "$OWNER_IDENTITY" | /usr/bin/security add-generic-password -U \
  -s fb-marketing-server -a openclaw-owner-identity -w
unset OWNER_IDENTITY
```

Meta credentials are separate from those records. The access token and App Secret are encrypted together as `{"accessToken": ..., "appSecret": ...}` in SQLite; only the envelope key named by `encrypted_credentials.key_ref` belongs in Keychain. Do not add either Meta value as a command argument, environment export, prompt, log line, or plaintext database value.

## 4. Configure one client/account scope

The only runtime environment setting is optional `PORT`; it defaults to `3000` and must be `1` through `65535`. `HOST` is intentionally not configurable. Production-style startup reads the service bearer and owner identity from Keychain rather than `OPENCLAW_SERVICE_TOKEN` or `OPENCLAW_OWNER_IDENTITY` in the process environment.

The SQLite database starts with schema only. A usable scope requires one coherent, validated record chain:

| Record | Required state |
|---|---|
| `clients` | Internal `<client_id>`, client name, portfolio ID, `active = 1` |
| `ad_accounts` | Exact `<ad_account_id>` owned by that client, name, currency, timezone, `active = 1` |
| `integrations` | Meta App ID, `state = 'active'`, `active = 1` |
| `integration_generations` | Active generation with non-null `validated_at` and null `retired_at` |
| `scope_mappings` | Exact client/account/generation pair, `active = 1`; all four authority flags set only after validation; required Meta tasks in `granted_tasks` |
| `encrypted_credentials` | Active encrypted access-token/App-Secret envelope for that generation, non-null `validated_at`, null `revoked_at`, actual permissions in `scopes`, and a Keychain `key_ref` |

Reads require `ads_read`. Mutations additionally require the `ADVERTISE` task and `ads_management`; capabilities can report further asset-specific gaps.

> **Provisioning boundary:** this repository currently has no supported command that creates these records or encrypts a real Meta credential. Provision and validate them through trusted operator work outside the model-facing API, following [Meta setup, pilot, and migration](meta-setup.md). Do not copy test fixture SQL into the live database. Until this is done, health can pass and the plugin can load, but `/v1/scopes` is empty and Meta-backed tools report configuration or scope errors.

Keep these placeholders distinct:

- `<client_id>`: your internal stable client identifier.
- `<ad_account_id>`: the exact Meta Ad Account identifier mapped to that client.
- `<channel>:<user_id>`: the single OpenClaw owner identity.
- `<attachment-root>`: an absolute directory used by OpenClaw for trusted inbound attachment files.
- `<credential-key-ref>`: the Keychain account selected by the trusted credential-provisioning process.

## 5. Start manually and verify health

Start in the foreground first so startup and Keychain errors are visible:

```bash
npm run build
npm start
```

In another terminal, stream the bearer from Keychain into curl configuration on stdin. It is not exported or placed in curl argv:

```bash
/usr/bin/security find-generic-password \
  -s fb-marketing-server -a openclaw-service-token -w | {
  IFS= read -r SERVICE_TOKEN
  printf 'header = "Authorization: Bearer %s"\n' "$SERVICE_TOKEN"
  unset SERVICE_TOKEN
} | curl --config - --fail --silent --show-error \
  --url http://127.0.0.1:3000/health
```

Expected shape:

```json
{"status":"ok","time":"<ISO-8601 timestamp>"}
```

Stop the foreground process with `Ctrl-C` after this check.

## 6. Build, pack, install, and configure the plugin

Use OpenClaw's managed `npm-pack:` path for the production-like local install. It validates the tarball through npm package semantics. Use `--link` only while developing the checkout.

```bash
cd packages/openclaw-plugin
npm ci
npm run build
mkdir -p "$HOME/Library/Application Support/fb-marketing-server/plugin-pack"
npm pack --pack-destination "$HOME/Library/Application Support/fb-marketing-server/plugin-pack"
openclaw plugins install \
  "npm-pack:$HOME/Library/Application Support/fb-marketing-server/plugin-pack/fb-marketing-server-openclaw-plugin-0.1.0.tgz"
```

Development-only alternative from the repository root:

```bash
openclaw plugins install --link ./packages/openclaw-plugin --force
```

Set the manifest's exact strict fields. No other plugin config keys are accepted. Replace only `<attachment-root>` with an absolute trusted OpenClaw inbound-media directory; do not grant a broad directory such as your home folder.

```bash
openclaw config set plugins.entries.fb-marketing-server.config \
  '{"baseUrl":"http://127.0.0.1:3000","keychainService":"fb-marketing-server","serviceTokenAccount":"openclaw-service-token","ownerProofAccount":"owner-proof-hmac-key","attachmentRoots":["<attachment-root>"],"timeoutMs":10000}' \
  --strict-json
```

Authorize exactly one owner, using the same value stored as `openclaw-owner-identity`:

```bash
openclaw config set commands.ownerAllowFrom \
  '["<channel>:<user_id>"]' --strict-json
openclaw plugins enable fb-marketing-server
openclaw gateway restart
```

The configuration contains Keychain references, not secrets. The restart is required after plugin or configuration changes.

## 7. Verify tools and owner commands

Inspect the installed runtime:

```bash
openclaw plugins inspect fb-marketing-server --runtime --json
openclaw plugins list --enabled --json
```

The plugin registers exactly these nine model tools:

| Tool | Scope behavior |
|---|---|
| `list_scopes` | Lists only authorized client/account pairs; no input scope |
| `integration_status` | Accepts no scope or an explicit pair |
| `get_capabilities` | Requires `client_id` and `ad_account_id` |
| `list_campaigns` | Requires `client_id` and `ad_account_id` |
| `query_insights` | Requires `client_id` and `ad_account_id` |
| `budget_summary` | Requires an explicit pair, or deliberate `global: true` composition |
| `upload_chat_media` | Requires an explicit pair and trusted inbound attachment context |
| `propose_operation` | Requires an explicit pair and creates only a pending proposal |
| `get_operation` | Requires an explicit pair and operation UUID |

It also registers exactly two deterministic commands outside model dispatch:

```text
/approve-ad <operation_id>
/reject-ad <operation_id>
```

Safe conversation checks, after replacing both placeholders with an authorized pair:

```text
List the authorized scopes. Then show integration status for client_id
<client_id> and ad_account_id <ad_account_id>. Do not infer either ID.
```

```text
List PAUSED campaigns for client_id <client_id> and ad_account_id
<ad_account_id>. Do not propose or execute a mutation.
```

```text
Prepare, but do not approve, a monthly budget operation for client_id
<client_id> and ad_account_id <ad_account_id>. Show the immutable operation ID,
payload, expiry, and next action.
```

Mutation flow is fixed: the model calls `propose_operation`, the service persists an immutable pending operation, the owner sends `/approve-ad <operation_id>` or `/reject-ad <operation_id>`, and only approval can execute. Natural-language agreement is not approval. New Campaign, Ad Set, and Ad objects are created `PAUSED`; Creative is bound without delivery status. Activation requires a separate proposal and owner approval.

## 8. Attach media from trusted chat

1. Attach exactly one fresh JPEG, PNG, or MP4 to the trusted OpenClaw chat message.
2. In that same sender/conversation context, ask OpenClaw to stage it for explicit `<client_id>` and `<ad_account_id>`.
3. OpenClaw supplies the trusted attachment context to the plugin. The model supplies neither a local path nor a URL.
4. `upload_chat_media` validates the attachment beneath `attachmentRoots`, sends multipart bytes over loopback, and returns an opaque `media_id` plus hash for a later proposal.

The inbound attachment claim expires after five minutes and must resolve to exactly one file. Server staging expires within 12 hours or earlier when the linked operation completes or expires.

## 9. Optional local LaunchAgent persistence

This is local service persistence for the logged-in Mac user, not production deployment. Run it only after foreground startup and health succeed.

```bash
npm run service:install
npm run service:status
```

The installer builds, writes `~/Library/LaunchAgents/com.gentleman-programming.fb-marketing-server.plist`, and starts the user job. Logs are in `~/Library/Logs/fb-marketing-server/`.

There is no separate root `service:stop` script. To stop the persisted service and remove only its plist, use:

```bash
npm run service:uninstall
```

Reinstall with `npm run service:install`. Application data and Keychain records are preserved.

## 10. Troubleshooting

| Symptom | Safe next action |
|---|---|
| Plugin not loaded | Run `openclaw plugins inspect fb-marketing-server --runtime --json`; confirm ID `fb-marketing-server`, exact OpenClaw `2026.9.2`, enabled state, built `dist/index.js`, and all required config fields; then restart the Gateway. |
| Owner command says unauthorized | Confirm the channel's exact sender ID, then make the single `commands.ownerAllowFrom` entry and Keychain `openclaw-owner-identity` identical `<channel>:<user_id>` values. A bare ID and multiple owners fail closed. |
| `Keychain access failed` or secret unavailable | Run both processes as the same logged-in macOS user, unlock the login Keychain, and confirm the required account exists using Keychain Access without revealing its value. Never move it to `.env` or plugin config. |
| Empty scopes or client/account mismatch | Complete out-of-band provisioning; verify the exact pair, active/validated generation and credential, authority flags, tasks, and scopes. Retry only with the explicit authorized pair returned by `list_scopes`. |
| Capability unavailable | Call `get_capabilities` for the exact pair and follow its diagnostic codes. Correct Meta permission, task, partner/asset assignment, or incompatible Page/pixel/form/Instagram selection before proposing. |
| Media unavailable | Send one new attachment in the same trusted channel, sender, account, and conversation; retry within five minutes. Confirm its real path is beneath a narrow `attachmentRoots` entry and is not a symlink. |
| Proposal rejected as invalid | Correct the typed payload and use a new 16-128 character idempotency key only when the intended payload changes. Never turn chat consent into approval. |
| Meta write is ambiguous or reconciliation is required | Do not approve again and do not automatically retry. Read the operation with `get_operation`, inspect the local audit/log evidence by `request_id`, reconcile the external Meta object state manually, and create a new proposal only after proving another write cannot duplicate the first. |

## 11. Security and non-goals

- Keep both OpenClaw and Fastify APIs on loopback. Do not add a public API, reverse proxy, tunnel, port forward, or webhook exposure.
- This integration is not MCP and does not expose MCP transport or tools.
- Never put service tokens, Meta access tokens, App Secrets, Keychain values, authorization headers, or owner proofs in prompts, logs, config JSON, shell argv, or Git.
- Never let the model choose or infer `client_id`, `ad_account_id`, attachment paths, approval identity, or a replacement credential.
- Never automatically retry an ambiguous Meta write. Reconciliation is operator work.
- One local account does not require the 14-app pilot or migration program. Real pilot, cutover, observation, rollback exercises, and migration remain optional operator work when expanding beyond this local use case.

For contract-level details, see [`openapi.yaml`](../openapi.yaml). For optional broader Meta provisioning and migration, see [`meta-setup.md`](meta-setup.md).

## 12. Files and directories created after setup

| Path | Purpose |
|---|---|
| `<repo>/node_modules/` | Root project dependencies. |
| `<repo>/dist/` | Compiled local gateway. |
| `<repo>/packages/openclaw-plugin/node_modules/` | Plugin dependencies. |
| `<repo>/packages/openclaw-plugin/dist/` | Compiled OpenClaw plugin. |
| `~/Library/Application Support/fb-marketing-server/state.sqlite` | Local SQLite state. |
| `~/Library/Application Support/fb-marketing-server/media/` | Private staged chat media. |
| `~/Library/Application Support/fb-marketing-server/plugin-pack/` | Locally packed plugin archive. |
| `~/Library/Logs/fb-marketing-server/` | Private `stdout.log` and `stderr.log` files. |
| `~/Library/LaunchAgents/com.gentleman-programming.fb-marketing-server.plist` | Optional per-user automatic startup configuration. |
| `~/.openclaw/npm/projects/` | OpenClaw-managed plugin installation. |

The related secrets are stored as Keychain records under service `fb-marketing-server`; they are not files in these directories.
