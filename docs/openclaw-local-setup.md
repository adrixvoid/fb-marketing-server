# Set up fb-marketing-server with OpenClaw on one Mac

This guide sets up the local server and its OpenClaw `2026.9.2` plugin. The server listens only on `http://127.0.0.1:3000`; people use it through configured OpenClaw outbound chat channels, not through a public API.

This is not an MCP server and is not a production deployment.

## Before you start

You need:

- macOS, with the login Keychain unlocked.
- Node.js `24.19.0` and npm `11.17.0`.
- OpenClaw `2026.9.2`, already connected to your Telegram bot.
- Your numeric Telegram user ID. Use the number from the bot's pairing reply, or run `openclaw pairing list telegram`. Do not use a username, phone number, chat ID, group ID, or bot ID.
- The absolute path to the directory where OpenClaw stores trusted inbound Telegram attachments.

Replace every value inside angle brackets before running a command:

| Placeholder | Example | Meaning |
|---|---|---|
| `<repo>` | `/Users/you/Sites/fb-server` | This repository's absolute path. |
| `<numeric_user_id>` | `123456789` | Your numeric Telegram user ID. |
| `<attachment-root>` | `/Users/you/.openclaw/media/inbound` | A narrow, trusted inbound-attachment directory. Do not use your home directory. |
| `<client_id>` | `client-acme` | Internal client ID, available only after Meta provisioning. |
| `<ad_account_id>` | `act_123456789` | Exact Meta Ad Account ID, available only after Meta provisioning. |

## Setup

### 1. Open the repository and verify prerequisites

Open Terminal, then run:

```bash
cd "<repo>"
nvm install
nvm use
npm install --global npm@11.17.0
node --version
npm --version
openclaw --version
```

Expected results:

```text
v24.19.0
11.17.0
OpenClaw 2026.9.2
```

Stop here if any version differs. Fix that prerequisite before continuing.

### 2. Install dependencies and build the server

Run from `<repo>`:

```bash
npm ci
npm run build
```

Expected result: both commands finish without an error, and `<repo>/dist/src/server.js` exists.

No `.env` file is required. Do not put secrets in `.env`. The only optional environment setting is `PORT`; it defaults to `3000`. `HOST` cannot be changed and is always `127.0.0.1`.

Use the default port for this guide. If port `3000` is already occupied, you may later start with `PORT=3001 npm start`, but you must also replace `3000` with `3001` in the health URL and plugin `baseUrl`. The optional LaunchAgent uses the default port.

### 3. Create the two required Keychain records

All records use Keychain service `fb-marketing-server`.

Create or rotate the local service token:

```bash
openssl rand -base64 32 | /usr/bin/security add-generic-password -U \
  -s fb-marketing-server -a openclaw-service-token -w
```

Expected result: the command returns to the prompt without printing the token.

Store the owner identity. At the prompt, enter only your numeric Telegram user ID; the command adds the required `telegram:` prefix:

```bash
printf 'Telegram numeric user ID: '
IFS= read -r TELEGRAM_USER_ID
printf 'telegram:%s\n' "$TELEGRAM_USER_ID" | \
  /usr/bin/security add-generic-password -U \
    -s fb-marketing-server -a openclaw-owner-identity -w
unset TELEGRAM_USER_ID
```

Expected result: Keychain contains these accounts under service `fb-marketing-server`:

```text
openclaw-service-token
openclaw-owner-identity = telegram:<numeric_user_id>
```

The owner identity is not a secret, but it must exactly match OpenClaw's Telegram sender identity. The server creates `owner-proof-hmac-key` and `cursor-hmac-key` automatically on first start.

### 4. Start the server in the foreground

Run from `<repo>`:

```bash
npm start
```

Expected result: the process stays running without a startup error. Leave this Terminal window open so errors remain visible.

Safe stop point: press `Ctrl-C` at any time. To continue later, return to `<repo>` and run `npm start` again.

### 5. Verify server health

Open a second Terminal window and run this command. It streams the token from Keychain to `curl` without placing the token in shell history, an environment export, or `curl` arguments:

```bash
/usr/bin/security find-generic-password \
  -s fb-marketing-server -a openclaw-service-token -w | {
  IFS= read -r SERVICE_TOKEN
  printf 'header = "Authorization: Bearer %s"\n' "$SERVICE_TOKEN"
  unset SERVICE_TOKEN
} | curl --config - --fail --silent --show-error \
  --url http://127.0.0.1:3000/health
```

Expected result:

```json
{"status":"ok","time":"<ISO-8601 timestamp>"}
```

Keep the server running for the remaining verification. If health fails, stop here and fix the displayed server or Keychain error.

### 6. Note the current Meta provisioning stop point

The repository currently has **no supported live provisioning CLI** for creating a client/account scope or encrypting a real Meta credential. Do not copy test fixture SQL into the live database.

Until trusted operator provisioning is completed:

- Server health can pass.
- The plugin can install and load.
- `list_scopes` returns an empty list.
- Meta-backed tools report configuration or scope errors.

Provisioning must create and validate the client, ad account, integration generation, scope mapping, authority flags, granted tasks, permissions, and encrypted credential described in [Meta setup, pilot, and migration](meta-setup.md).

The Meta access token and App Secret are encrypted together in SQLite. SQLite stores only ciphertext, IV, authentication tag, and the Keychain account reference. Only the random 32-byte envelope key belongs in Keychain. Never put the Meta token or App Secret in command arguments, shell history, `.env`, logs, Git, model prompts, or plaintext SQLite.

Safe stop point: if you only need to prove the local server works, stop it with `Ctrl-C`. Meta-backed verification cannot continue until provisioning is available and completed.

### 7. Build and install the OpenClaw plugin

In the second Terminal, run:

```bash
cd "<repo>/packages/openclaw-plugin"
npm ci
npm run build
mkdir -p "$HOME/Library/Application Support/fb-marketing-server/plugin-pack"
npm pack --pack-destination "$HOME/Library/Application Support/fb-marketing-server/plugin-pack"
openclaw plugins install \
  "npm-pack:$HOME/Library/Application Support/fb-marketing-server/plugin-pack/fb-marketing-server-openclaw-plugin-0.1.0.tgz"
```

Expected result: npm creates `fb-marketing-server-openclaw-plugin-0.1.0.tgz`, and OpenClaw reports that plugin `fb-marketing-server` was installed. Review and accept OpenClaw's local-plugin warning only if `<repo>` is the checkout you intend to trust.

### 8. Configure the plugin and authorize the owner

Replace `<attachment-root>` and `<numeric_user_id>`, then run:

```bash
openclaw config set plugins.entries.fb-marketing-server.config \
  '{"baseUrl":"http://127.0.0.1:3000","keychainService":"fb-marketing-server","serviceTokenAccount":"openclaw-service-token","ownerProofAccount":"owner-proof-hmac-key","attachmentRoots":["<attachment-root>"],"timeoutMs":10000}' \
  --strict-json
openclaw config set commands.ownerAllowFrom \
  '["telegram:<numeric_user_id>"]' --strict-json
openclaw plugins enable fb-marketing-server
openclaw gateway restart
```

Expected result: each command succeeds, the plugin is enabled, and the Gateway restarts. The value `telegram:<numeric_user_id>` must be identical here and in Keychain account `openclaw-owner-identity`.

These commands configure owner-only plugin commands; they do not replace your existing Telegram channel setup. The plugin configuration contains Keychain account names, not secret values.

### 9. Verify the plugin

Run:

```bash
openclaw plugins inspect fb-marketing-server --runtime --json
openclaw plugins list --enabled --json
```

Expected result: `fb-marketing-server` is installed, enabled, and loaded from built `dist/index.js`. Its runtime registers these nine tools:

```text
list_scopes
integration_status
get_capabilities
list_campaigns
query_insights
budget_summary
upload_chat_media
propose_operation
get_operation
```

It also registers two owner-only commands:

```text
/approve-ad <operation_id>
/reject-ad <operation_id>
```

In your authorized Telegram chat, send:

```text
List the authorized scopes. Do not infer any client or ad account ID.
```

Expected result before Meta provisioning: an empty scope list, not invented IDs. After provisioning, use the returned IDs for checks such as:

```text
Show integration status for client_id <client_id> and ad_account_id
<ad_account_id>. Do not infer either ID.
```

```text
List PAUSED campaigns for client_id <client_id> and ad_account_id
<ad_account_id>. Do not propose or execute a mutation.
```

Never use natural-language agreement as approval. A mutation starts as an immutable pending proposal and executes only after the configured owner sends `/approve-ad <operation_id>`. New Campaign, Ad Set, and Ad objects are created `PAUSED`; activation requires a separate proposal and approval.

### 10. Optionally keep the server running with a LaunchAgent

Do this only after foreground health and plugin verification succeed.

First return to the Terminal running `npm start` and press `Ctrl-C`. This prevents two server processes from competing for port `3000`.

Then run from `<repo>`:

```bash
cd "<repo>"
npm run service:install
npm run service:status
```

Expected result: the status command shows the loaded user job `com.gentleman-programming.fb-marketing-server`. The installer builds the server, writes `~/Library/LaunchAgents/com.gentleman-programming.fb-marketing-server.plist`, and writes private logs under `~/Library/Logs/fb-marketing-server/`.

Safe stop point: remove only the LaunchAgent and stop its process with:

```bash
npm run service:uninstall
```

Application data and Keychain records remain in place. Reinstall later with `npm run service:install`.

## Trusted Telegram attachments

After Meta provisioning, attach exactly one fresh JPEG, PNG, or MP4 and ask OpenClaw to stage it for an explicit `<client_id>` and `<ad_account_id>` in the same message. The model must not supply a local path or URL. The attachment claim expires after five minutes and must resolve beneath the configured `<attachment-root>` to exactly one non-symlink file.

## Troubleshooting

| Symptom | Safe next action |
|---|---|
| Wrong Node, npm, or OpenClaw version | Return to step 1. Do not continue with a different version. |
| `Keychain access failed` | Use the same logged-in macOS user for the server and OpenClaw, unlock the login Keychain, and confirm both required accounts exist in Keychain Access. Do not move values to `.env`. |
| `EADDRINUSE` | Stop the other process on port `3000`, especially a previously installed LaunchAgent. Use another `PORT` only if you also update the health URL and plugin `baseUrl`. |
| Plugin not loaded | Run `openclaw plugins inspect fb-marketing-server --runtime --json`; confirm version `2026.9.2`, enabled state, built `dist/index.js`, and the exact configuration fields, then restart the Gateway. |
| Owner command says unauthorized | Confirm the Telegram numeric sender ID. Make Keychain `openclaw-owner-identity` and `commands.ownerAllowFrom` exactly `telegram:<numeric_user_id>`. A bare number, username, or multiple owners fails closed. |
| Empty scopes | This is expected before trusted Meta provisioning. There is currently no supported live provisioning CLI. |
| Capability unavailable | After provisioning, call `get_capabilities` for the exact pair and follow its diagnostic codes. Do not guess another account or credential. |
| Ambiguous Meta write | Do not approve again or automatically retry. Read the operation, reconcile Meta state manually, and create a new proposal only after proving it cannot duplicate the first write. |

## Security rules

- Keep the Fastify service and OpenClaw Gateway on loopback. Do not add a public API, proxy, tunnel, port forward, or webhook exposure.
- Never put service tokens, Meta access tokens, App Secrets, Keychain values, authorization headers, or owner proofs in command arguments, shell history, `.env`, logs, Git, model prompts, or plaintext SQLite.
- Never let the model choose or infer a client ID, ad account ID, attachment path, approval identity, or replacement credential.
- Never automatically retry an ambiguous Meta write.
- Use Keychain service `fb-marketing-server`. Meta token and App Secret ciphertext belong in SQLite; only the envelope key belongs in Keychain.

For contract details, see [`openapi.yaml`](../openapi.yaml). For provisioning and migration requirements, see [Meta setup, pilot, and migration](meta-setup.md). For backup, restore, rotation, and private operations, see [Secure remote access](remote-access.md).
