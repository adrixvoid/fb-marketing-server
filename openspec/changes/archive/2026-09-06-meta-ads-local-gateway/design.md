# Design: Meta Ads Local Gateway

## Technical Approach

Build one Node 24/TypeScript process from `openapi.yaml`, plus an OpenClaw plugin workspace because it runs inside the host with an SDK peer dependency. Deliver vertical slices under 400 changed lines; disable mutations until approval, audit, and recovery checks pass.

## Architecture Decisions

| Decision | Choice and rationale |
|---|---|
| Service boundary | Fastify binds `127.0.0.1`; authenticate before state access. `openapi-backend` matches operations and validates security/request JSON; a post-response hook validates responses. `/v1/media` is the exception: OpenAPI validates route/headers/security, while `@fastify/multipart` streams with field, size, filename, declared MIME, `file-type`, and full-consumption checks. |
| Contract artifacts | `scripts/generate-contract.ts` reads `openapi.yaml` using direct `yaml`, compiles runtime request/response schemas with AJV 2020, and emits `src/generated/contract-options.ts` (authoritative runtime enums/options); `openapi-typescript` emits types. Generated files are checked for drift, never hand-edited. The curated OpenClaw tool projection is deferred to Unit 6 rather than hand-maintained in this generator. |
| Persistence | One `node:sqlite` database with WAL, foreign keys, prepared statements, and `PRAGMA user_version` migrations. Pre-release migration v1 contains only Unit 2 ownership: clients, integrations/generations, Ad Accounts, authorized scope mappings, versioned AES-256-GCM credential envelopes, exact monthly budgets, and append-only audit metadata. Budgets store nonnegative JavaScript-safe integer minor units in `amount_minor`; a composite FK requires their currency to equal the owned Ad Account currency. Media, operations, decisions, executions/steps, and proof nonces are deferred to migrations introduced by their owning tasks. Keys and service/proof secrets stay in Keychain. |
| Local secret and file safety | Keychain writes use `/usr/bin/security` prompt mode with secret bytes sent over stdin, never argv; a 10-second default timeout aborts/kills the child and subprocess failures are replaced with cause-free errors. File databases, backups, and restores require an owner-only trusted data root and close on failed initialization. Backup publication reserves the destination at `0600`, works inside a `0700` temporary directory with a precreated `0600` database, rejects symlinks/out-of-root or existing destinations, and requires `integrity_check`, `foreign_key_check`, supported version, and an exact SHA-256 schema fingerprint before atomic rename. |
| Transactions | Proposal + permanent idempotency reservation + media binding commit together. Decision + unique execution claim commit before network I/O; never hold SQLite transactions across Meta calls. Each bundle step and normalized audit outcome commits together. Unique operation execution and step keys prevent replay; uncertain dispatch becomes internal `reconciliation_required` (API remains `executing`) and is never retried automatically. |
| Meta transport | `MetaClient` uses native `fetch`, fixed `/v26.0`, bearer auth, HMAC `appsecret_proof`, timeout, redacted errors, and captured `Retry-After`/Meta usage headers. Retry bounded reads, `429`, and transient failures only. Async Insights starts a job, polls, then pages results. Bundle steps persist external IDs; partial bundles reconcile before continuation. |
| Time and money | Keep `decimal.js` for half-even currency/ratio arithmetic. Add runtime `@js-temporal/polyfill`: derive zoned month start and next month start, convert both and `as_of` to instants, then divide exact elapsed nanoseconds. Hand-written `Intl.DateTimeFormat` offset iteration is dependency-free but materially larger and error-prone at DST gaps/folds. Import locally (no global patch); remove when the pinned Node exposes compatible Temporal. |
| Plugin and proof | `packages/openclaw-plugin` exposes only the nine specified tools. Trusted attachment bytes come solely from host context; absence fails closed before HTTP. Slash commands run outside model dispatch and send a short-lived HMAC proof binding channel-scoped owner, action, operation ID, issued time, and nonce; the service verifies constant-time and consumes the nonce once. |

## Data Flow

```text
Chat -> OpenClaw plugin -> Fastify/auth -> OpenAPI validation -> scope/authority
                              |                                  |
                     trusted multipart                      MetaClient v26
                              v                                  |
                       private media <- SQLite/audit <------------+
Owner command -> signed proof -> operation claim -> Meta steps -> correlated result
```

## File Changes

| Path | Action | Responsibility |
|---|---|---|
| `package.json`, `package-lock.json`, `tsconfig.json` | Create | Service workspace, exact dependencies, build/test/generate scripts. |
| `scripts/generate-contract.ts`, `src/generated/contract-options.ts`, `src/generated/openapi.d.ts` | Create | Compiled OpenAPI 3.1 schemas, generated runtime options, and API types. |
| `src/app.ts`, `src/server.ts`, `src/contract.ts` | Create | Composition, loopback startup, auth/validation pipeline. |
| `src/db.ts`, `src/migrations.ts`, `src/secrets.ts` | Create | SQLite schema/transactions, migrations, Keychain-backed encryption. |
| `src/scope.ts`, `src/meta-client.ts`, `src/reporting.ts`, `src/pacing.ts` | Create | Isolation, capabilities/pagination, Meta/Insights, exact pacing. |
| `src/media.ts`, `src/operations.ts` | Create | Staging lifecycle, immutable proposals, proof, execution/reconciliation. |
| `packages/openclaw-plugin/package.json`, `packages/openclaw-plugin/src/index.ts` | Create | Host peer package, curated tools, trusted attachments, owner commands. |
| `scripts/install-launchagent.ts` | Create | Resolve stable `process.execPath`, install per-user plist, data/log paths; never invoke `nvm`. |
| `test/*.test.ts` | Create | Runnable checks described below. |

## Interfaces / Contracts

`RequestContext` carries caller/request ID; `ResolvedScope` is mandatory before Meta access. `MetaClient.request` accepts fixed logical endpoints and returns normalized data plus rate evidence. `OperationStore.claimDecision(operationId, payloadHash, proof)` atomically returns a terminal result, execution claim, or conflict. Cursors bind caller, scope, and filter hash; capability assets sort by type then opaque ID and repeat context on every page.

## Testing Strategy

Use `node:test`: unit fixtures for scope/cursors, canonical hashes, proof replay, 12-hour equality, Temporal DST/month boundaries, decimal rounding, metrics, and retry classification; `Fastify.inject()` plus in-memory/temp SQLite for auth, OpenAPI request/response, multipart, transactions, idempotency, restart/reconciliation, and canary scans; fake `fetch` for rate headers, async Insights, pagination, and ambiguous writes. Run generator drift and OpenAPI reference/response checks. Re-detect testing and `strict_tdd` after scaffold creation.

## Migration / Rollout

Inventory all 14 apps; enable read-only foundation, pilot both accounts, then approval controls, one reversible mutation, paused bundles, and one-client-at-a-time cutover. Freeze/reconcile each scope, bind work to its generation, retain the prior integration at least seven days, and rollback by disabling mutations and restoring protected SQLite state.

## Open Questions

- Verify the installed OpenClaw public SDK version/imports and trusted attachment context before implementing the plugin slice.
