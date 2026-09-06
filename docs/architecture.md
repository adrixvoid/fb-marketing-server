# Target architecture and phased delivery

`fb-marketing-server` is a private local integration between OpenClaw and Meta Marketing API `v26.0`. OpenClaw is its only caller, every Meta call and scoped operation resolves an explicit client and ad account, and every mutation requires a deterministic owner command outside the LLM from the single global human approver.

[Product and system requirements](requirements.md) is the normative source for behavior and acceptance criteria. This document defines how those requirements are implemented and delivered; [Technology decisions](technology.md) records the chosen stack and rejected alternatives.

## Decisions

| Area | Decision |
|---|---|
| Deployment | Run the Node.js server on macOS as a `launchd` LaunchAgent started at user login. |
| Network | Bind `fb-marketing-server` to `127.0.0.1`. OpenClaw is the only local caller and authenticates with a dedicated internal service token. |
| Remote access | Users interact through configured OpenClaw outbound chat channels. Network administration is limited to authenticated shell access to the Mac. |
| Meta model | Target one agency-owned Meta Business App and one agency System User as a project choice, not a Meta mandate, while preserving all 14 existing Developer Apps until migrations are proven. |
| Client ownership | Each legally distinct client Business Portfolio retains its Business Assets. Clients grant the agency portfolio partner access only to required assets and tasks. |
| Reads | Read-only metrics and diagnostics may execute without approval after client and ad account resolution. |
| Contract | Authenticated `/health`, paginated `/v1/scopes`, and safe integration status are the only unscoped discovery exceptions. All scoped operations require `client_id` and `ad_account_id`. OpenAPI enums define static options; scoped `/v1/capabilities` supplies currently accessible dynamic Meta assets and capability status. |
| Meta version | Pin `v26.0` for MVP. Upgrade deliberately after endpoint, permission, payload, fixture, and pilot regression validation; never let callers choose the version. |
| Mutations | Complete Campaign/Ad Set/Creative/Ad creation, edits, activation, pausing, resuming, and budget changes become immutable pending operations. Creation supports exactly three product campaign kinds, uses Meta validate-only preflight where applicable, and still requires owner approval. It produces Campaign, Ad Set, and Ad `PAUSED` and creates/binds Creative without delivery status; activation requires separate approval. |
| Data | Use SQLite with encrypted credential metadata, WAL mode, foreign keys, transactions, and tested backups. |
| Interface | The global administrative chat is the primary interface. A web dashboard is optional after MVP, not a prerequisite. |

## System context

```text
Global administrative chat
          |
          v
OpenClaw (authentication, chat interaction, remote-access boundary)
          |
          | localhost HTTP + dedicated internal service token
          v
Node.js fb-marketing-server (127.0.0.1)
          |
          | HTTPS + authorized Meta credential
          v
Meta Marketing API
```

Remote users interact through configured OpenClaw outbound chat channels. The local service is not a user-access boundary. Operational controls live in [Private operation and outbound chat access](remote-access.md).

## Trust boundaries

| Boundary | Required control |
|---|---|
| Chat to OpenClaw | Authorize commands through channel pairing/allowlisting and require the one configured channel-scoped owner for mutation decisions. |
| OpenClaw to `fb-marketing-server` | Accept only loopback HTTP requests carrying the dedicated internal service token. Keep this token in protected plugin/runtime configuration, unavailable to the model and separate from Meta credentials. |
| `fb-marketing-server` to Meta | Select a credential explicitly authorized for the resolved client, asset, and endpoint. |
| Process to local storage | Keep the encryption key in macOS Keychain; never store it in SQLite, source control, logs, or AI context. |
| Remote network | User access terminates at an allowlisted OpenClaw outbound chat channel; both local APIs remain loopback-only. |

## Meta concepts

| Concept | Meaning in this architecture |
|---|---|
| Meta Business Suite | Meta's operator UI. It is not an ownership or credential object. |
| Business Portfolio | The organization boundary that owns or receives access to Business Assets. Each client portfolio represents a legally distinct client. |
| Developer App | The Meta application identity against which permissions and access levels are reviewed. It does not itself grant access to every client asset. |
| System User | A non-human identity within a Business Portfolio. The agency System User receives assigned partner-shared assets and tasks. |
| Access Token | A revocable credential bound to an app and subject, carrying scopes. Meta does not provide a standard OAuth `refresh_token` for this model. |
| Business Assets | Ad Accounts, Pages, Instagram accounts, pixels/datasets, catalogs, and related resources owned by or shared with a Business Portfolio. |

## Effective authority

An API call is allowed only where all authority layers overlap:

```text
effective authority
  = app review and access level
  ∩ token validity and scopes
  ∩ token subject authority
  ∩ partner relationship
  ∩ asset assignment and tasks
  ∩ endpoint requirements
```

Missing authority is a configuration problem, not a condition to bypass. Another credential may be selected only when it is explicitly authorized for the same client and asset.

## Partner access lifecycle

Partner access is a two-party workflow; the agency cannot assume or complete client authority unilaterally.

| Step | Authorized actor | Required record |
|---|---|---|
| Grant or accept partner access and asset tasks | Client administrator authorized for the client Business Portfolio | `pending` then `accepted` status, actor, timestamp, requested assets/tasks, and redacted Meta evidence. |
| Assign received assets and tasks to the agency System User | Agency administrator authorized for agency portfolio `3981018332186282` | Assignment status, actor, timestamp, System User, exact assets/tasks, and redacted validation evidence. |
| Validate API authority | Agency operator | Per-asset endpoint result and timestamp; no successful asset may stand in for another. |

Client Business Assets remain client-owned throughout this lifecycle.

## Request and approval rules

FR-1 through FR-3 define canonical request resolution and labeling. `/v1/scopes` is the sole client/account discovery list. Apart from authenticated health and safe integration diagnostics, every operation requires both IDs. Errors preserve each input-supplied ID exactly in `supplied_scope`; resolved labels appear only after successful resolution. Capability `400/401/403/409` errors never expose `resolved_scope`, and mismatch `409` preserves both required query IDs. The global chat reads static choices from OpenAPI, then pages `/v1/capabilities` for a deterministic discriminated asset collection and actionable availability. Every page repeats scope, account/integration metadata, campaign kinds, capability statuses, and gaps so the agent never guesses. Proposal creation and execution revalidate selected assets.

| Operation | Execution rule |
|---|---|
| Read metrics or diagnostics | Execute directly after authorization and explicit scope resolution when scoped. Valid Insights with no data return `200` with an empty page; `422` means a semantically unsupported query or metric. Diagnosed Meta integration states return `200`; `403` is local caller authorization failure. |
| Discover scoped capabilities | Resolve both IDs, page one deterministic typed asset collection, repeat safe context on every page, return null currency/timezone only with actionable gaps, and audit Meta validation calls. This is read-only discovery: it neither creates an operation nor grants approval. |
| Ingest creative media | Accept only host-trusted inbound attachment bytes and metadata from supported public OpenClaw SDK context, fail closed without it, copy bytes to private staging, validate content and Meta limits, hash and bind them to the resolved operation, and reject model-supplied paths or URLs. PNG validation enforces valid CRCs and the required unique/ordered `IHDR`, optional `PLTE`, contiguous `IDAT`, and terminal `IEND` structure without decoding pixels. Owner commands remain separate. |
| Create a complete campaign | Accept one product campaign kind, derive the fixed Meta combination, validate dynamic asset strings at runtime, and use validate-only preflight where applicable. Store one immutable operation valid while `now < created_at + 12 hours`. Approval creates Campaign, Ad Set, Creative, and Ad exactly once; only Campaign, Ad Set, and Ad are `PAUSED`, and Creative is bound. |
| Edit, activate, pause, resume, or change budget | Store an immutable scoped operation. Delivery transitions support only Campaign, Ad Set, and Ad; Creative has no transition. Activation of new delivery objects requires separate approval. |
| Approve a pending operation | Require `/approve-ad <operation_id>` from the one configured owner. Bind the decision to the immutable operation ID and payload, then record it separately. |
| Reject a pending operation | Require `/reject-ad <operation_id>` from the same owner and prevent later execution. |
| Execute an approved operation | Atomically claim it once, persist intent before every write, and record each outcome. Resume only known successful partial steps after restart; pause unresolved writes for reconciliation without redispatch. |
| Expire a pending operation | Prevent later execution; create a new pending operation if the change is still wanted. |

### Approval identity and command boundary

Implement approval as deterministic OpenClaw plugin/native commands, not as an LLM intent. Configure exactly one channel-scoped owner identity after OpenClaw pairing or allowlisting establishes the sender:

```json5
{
  commands: {
    ownerAllowFrom: ["<channel>:<user_id>"]
  }
}
```

Do not choose the channel until deployment. A WebChat identity or bare user ID is insufficient because it does not bind the approver to a channel identity. For both `/approve-ad` and `/reject-ad`, the command handler must:

1. Run outside model dispatch and require both `isAuthorizedSender` and `senderIsOwner`.
2. Resolve the immutable operation by `operation_id` and bind the decision to its stored payload; accept it only while `now < created_at + 12 hours`, treating equality as expired, and reject missing, changed, completed, or replayed operations.
3. Revalidate the target, budget, Meta authority, credential generation, and bound media hash immediately before execution.
4. Call `fb-marketing-server` over localhost with a dedicated service credential held in protected plugin/runtime configuration and unavailable to the model.
5. Record the channel-scoped owner identity, operation ID, payload identity, decision, and outcome.

The LLM may propose and display pending operations. It cannot invoke the handler, supply its credential, forge owner context, or convert natural-language agreement into approval.

#### Owner-command proof protocol

The runtime requires exactly one `OPENCLAW_OWNER_IDENTITY` value in `<channel>:<user_id>` form. The proof secret is a separate 32-byte Keychain value named `owner-proof-hmac-key`; it is unavailable to model dispatch and is never sent in HTTP, logs, responses, or audit evidence.

`X-OpenClaw-Owner-Command` uses this canonical encoding:

```text
v1.<issued_at_unix_seconds>.<nonce_base64url>.<owner_identity_base64url>.<signature_base64url>
```

The nonce is 16–32 random bytes using unpadded canonical base64url. The owner identity is UTF-8 encoded with unpadded canonical base64url. The signature is an unpadded base64url HMAC-SHA256 over these newline-delimited UTF-8 fields, in order:

```text
v1
<HTTP method in uppercase>
<raw path including the exact query string>
<approved|rejected>
<operation_id>
<lowercase SHA-256 hash of the exact request body bytes>
<channel-scoped owner identity>
<issued_at_unix_seconds>
<nonce_base64url>
```

The signature therefore binds the exact request method, raw path including query string, and SHA-256 body hash as well as the decision, operation, owner, timestamp, and nonce. Approve/reject requests have no body: any `Transfer-Encoding`, non-canonical or nonzero `Content-Length`, or parsed body is rejected before proof verification and decision processing. A proof is valid through exactly 300 seconds and MUST NOT be issued in the future. Freshness is checked again after secret lookup and at transaction entry. Verification uses timing-safe signature comparison, and each accepted nonce is persisted once before lifecycle processing so replay remains rejected across concurrency and restarts.

Approval commands use durable fixed-window ingress limits: at most 120 admitted attempts per minute globally and 60 per minute for the configured owner. Excess attempts are rejected before proof processing with `429`, `Retry-After`, and bounded durable admitted/rejected counters. Every admitted attempt appends audit evidence. Audit rows are retained permanently, so their storage is not bounded, but their maximum growth is globally bounded to 120 rows per minute. Unreferenced proof nonces are deleted at startup and before each decision only after their 300-second replay horizon has elapsed; the fixed-window burst bound is 720 replay-cache rows (120 × six possible overlapping windows). Nonces referenced by immutable decisions are retained permanently.

The global chat may compose an operational budget table by paging `/v1/scopes` and requesting pacing once per authorized pair. If Meta timezone is unavailable, the contract retains currency and monthly budget while explicitly marking reporting month and every timezone-dependent or derived value unavailable with reason `timezone_unavailable`. Otherwise FR-12 through FR-14 apply exact elapsed time; exact month start reports zero progress and expected spend while only projection is unavailable. Money uses ISO 4217 minor-unit round-half-even; ratios use 6 decimal places round-half-even.

### Campaign kind mapping

| Kind | Derived values | Required dynamic values |
|---|---|---|
| `SALES_WEBSITE` | `OUTCOME_SALES`, `WEBSITE`, `OFFSITE_CONVERSIONS`, `IMPRESSIONS`, `PURCHASE` | `pixel_id`, website URL |
| `LEADS_WEBSITE` | `OUTCOME_LEADS`, `WEBSITE`, `OFFSITE_CONVERSIONS`, `IMPRESSIONS`, `LEAD` | `pixel_id`, website URL |
| `LEADS_INSTANT_FORM` | `OUTCOME_LEADS`, `ON_AD`, `LEAD_GENERATION`, `IMPRESSIONS` | `page_id`, published matching `lead_gen_form_id` |

Callers do not combine these Meta values independently. Asset IDs stay opaque strings validated at runtime. The OpenAPI CTA union is narrowed at runtime by campaign kind. Advantage+, bid strategies, attribution windows, messaging, call, catalog, app, omnichannel, `QUALITY_LEAD`, and `VALUE` remain outside MVP.

### Retry bindings

- `Idempotency-Key` binds authenticated caller, operation type, scope, and canonical payload hash. Same payload returns the immutable existing operation; different payload returns `409 idempotency_conflict`. The reservation has no short replay window.
- Pagination cursors bind authenticated caller, client/account scope where applicable, and a hash of every filter. Mismatched reuse returns `400`.
- Never automatically retry an ambiguously dispatched Meta write; retry a write only when endpoint-level idempotency exists or reconciliation proves first attempt did not commit. Reads, `429`, and temporary failures may use bounded `Retry-After`-aware retries.
- Meta POSTs carry `appsecret_proof` in the form body. Meta GETs may carry it in the query only because Graph read endpoints require query parameters; request URLs are therefore excluded from logs and audit evidence, and all HTTP logging must redact the complete query string before serialization.

## Local deployment and storage

| Concern | Target |
|---|---|
| Process lifecycle | Per-user `launchd` LaunchAgent, started at login and restarted according to its configured policy. |
| Listener | `127.0.0.1` only. |
| Database | `~/Library/Application Support/fb-marketing-server/` |
| Logs | `~/Library/Logs/fb-marketing-server/` with secrets and authorization headers redacted. |
| Encryption key | macOS Keychain. |
| Meta credentials | Encrypted at rest; never returned to OpenClaw or exposed to AI/chat. |
| OpenClaw service token | Cryptographically random, generated outside the repository, stored in macOS Keychain or injected through a protected SecretRef/runtime mechanism, restricted to the service/plugin, excluded from Git, and rotated. Never expose it to prompts, model tools, or logs. |

The production runtime loads both the service token and channel-scoped owner identity from the login Keychain. The checked-in installer builds first, atomically writes and validates a secret-free per-user LaunchAgent, and uses absolute executable/project paths. SIGTERM and SIGINT close the HTTP application and SQLite once. Operational commands, logs, health checks, protected two-stage restore, Keychain availability, FileVault, firewall, and rotation constraints are documented in [Secure remote access](remote-access.md#fb-marketing-server-configuration-and-lifecycle).

## Data model boundaries

These are schema-level concepts, not implementation prescriptions.

| Concept | Responsibility |
|---|---|
| `clients` | Stable identity and Business Portfolio mapping for each legally distinct client. |
| `meta_apps` / `integrations` | Existing and target Developer Apps, portfolio ownership, credential subjects, permissions, validation evidence, and integration state. |
| `ad_accounts` / `assets` | Client-owned Meta Business Assets, external IDs, ownership, partner sharing, tasks, and integration association. |
| Encrypted credential metadata | Ciphertext reference, app and subject binding, scopes, lifecycle status, validation timestamps, and revocation evidence; never plaintext tokens. |
| `operations` / `approval_decisions` | Immutable requested mutations, explicit decisions, expiry, idempotency identity, and terminal state. |
| `operation_executions` / `operation_steps` | One atomic execution claim and immutable intent/outcome history for restart-safe mutation reconciliation. |
| `audit_log` / execution audit links | Append-only metadata for every Meta call, including reads, diagnostics, credential maintenance, mutations, failures, correlation IDs, actor/target context, and linked approval/execution/step evidence. Tokens, headers, and complete bodies are excluded. |

SQLite must use WAL mode and foreign-key enforcement. Multi-record state changes, especially approval and execution transitions, must be transactional. Migration v6 preserves exact compatible v5 result bytes, step correlations, and linked audits; it fails closed instead of normalizing incompatible or unaudited history. Migration v7 enforces strict predecessor order and NULL-safe terminal-result shapes. Migration v8 preflights existing v7 evidence, rebuilds execution-audit links with step-key constraints, binds media steps to the exact scoped `operation_media` row, and requires every typed result resource to match the ordered immutable successful-step projection. Corrupt upgrades roll back at user version 7 without rewriting result bytes, correlations, or audits. New runtime claim, step, result, and reconciliation audits remain transactionally linked. Backups must include a documented restore test and must remain protected by the same local access controls as the live database.

Credential validation, state maintenance, and human reauthorization run as internal scheduled or administrative mechanisms outside the model-facing HTTP contract. No credential-maintenance endpoint is required; safe integration status is the only HTTP diagnostic view.

## Integration states

| State | Meaning |
|---|---|
| `registered` | Inventory record exists, but validation has not completed. |
| `validating` | Permissions, token, subject authority, partner relationship, asset assignments, and endpoint access are being checked. |
| `active` | Required calls for the authorized client assets have passed validation. |
| `configuration_required` | App, access level, review, or local configuration is incomplete. |
| `reauthorization_required` | Credential is invalid, expired, revoked, or otherwise requires human-issued replacement. |
| `asset_access_required` | App and credential may be valid, but partner sharing, asset assignment, or required tasks are missing. |

## Integration generations and cutover

Each pending operation records the integration generation it was validated against. Before switching a client or asset to a replacement generation:

1. Freeze new mutations for that scope.
2. Drain and reconcile pending, in-flight, and retried work against its bound generation; do not silently execute it with replacement credentials.
3. Validate replacement authority and define rollback triggers, including authorization regression, endpoint mismatch, duplicate risk, or incomplete audit evidence.
4. Switch reads and mutations only after reconciliation, retain the previous generation as rollback, and verify the new generation.
5. Resume mutations only when reconciliation proves that no operation can duplicate or run with the wrong credentials.

`scripts/validate-migration.ts` makes this phased process deterministic without becoming a control plane. It validates the exact 14-app inventory and pilot-first batches, reads append-only redacted local evidence, and reports the first unmet gate. It does not call Meta, approve operations, change routing, or retire credentials. The paused canary must already carry a normal owner decision and prove every created delivery object remained `PAUSED`; old integrations remain available for rollback until an evidenced observation of at least seven full days completes.

## Delivery plan

Agency Business ID `3981018332186282` and pilot Business ID `290166249089842` are identifiers, not secrets.

| Phase | Outcome | Exit evidence |
|---|---|---|
| 0. Inventory | Register all 14 existing Meta Developer Apps without deleting or consolidating them. | Each app has ownership, client mapping, credentials, permissions, assets, state, and gaps recorded. |
| 1. Local read-only foundation | Run the private local service, authenticate OpenClaw, store metadata safely, and query authorized metrics. | Loopback and token controls pass; read-only calls are audited; backup and restore are tested. |
| 2. Agency preparation | Business-verify agency portfolio `3981018332186282`, create one central agency-owned Meta Business App, complete required review/access work, and create the agency System User. | Meta confirms the required business, app, permission/access, and System User prerequisites for the pilot endpoints. |
| 3. Pilot read-only proof | Add partner access for pilot portfolio `290166249089842`, assign its two Ad Accounts separately, and validate reads and diagnostics only. | Both accounts pass independent authorization and metric checks without enabling mutation execution. |
| 4. Approval infrastructure | Implement owner-only commands, immutable pending operations valid only while `now < created_at + 12 hours`, pre-execution revalidation, generation binding, idempotency, and separate audit evidence before any pilot mutation. | Unauthorized, natural-language, changed, expired (including exactly at 12 hours), stale, replayed, and duplicate attempts cannot execute. |
| 5. Pilot reversible mutation | Run one low-risk reversible mutation and its rollback through the Phase 4 controls. | The change and rollback each execute at most once with complete linked approval and audit evidence. |
| 6. Broader approved mutations | Enable complete creation with Campaign, Ad Set, and Ad in `PAUSED` delivery state and the Creative created/bound without that status, plus confirmed edit/manage/activate/pause/resume and budget paths. | Every enabled path requires valid approval and produces complete audit evidence; activation uses a separate approval from creation. |
| 7. Client migration | Migrate one client at a time to the central app and agency System User, retaining the previous integration as rollback for at least 7 days after reconciled cutover and successful validation. | Each client's required assets and endpoints pass validation before traffic changes; rollback is rehearsed and the observation window is recorded. |
| 8. Retirement | Revoke and retire old app credentials only after the 7-day observation window and all replacement and rollback criteria are satisfied. | No active client or asset depends on the old app; evidence and owner approval are recorded. |

An optional web dashboard may be considered only after the chat/API workflow is stable. It does not change the approval, authorization, or audit model.

## Non-goals

- Publicly exposing `fb-marketing-server` or adding a public token-renewal endpoint.
- Transferring client Business Assets into the agency portfolio.
- Deleting or consolidating the 14 existing Developer Apps during initial phases.
- Automatically substituting credentials across clients or assets.
- Exposing Meta tokens or app secrets to OpenClaw, chat, logs, or AI context.
- Requiring Facebook Login for Business for the manually provisioned System User flow unless Meta requirements for the selected endpoints prove it necessary.
- Ranking or comparing clients in global reports.
- Deleting ads or other managed ad objects in MVP.
- Reading creative media from Google Drive, arbitrary remote URLs, or arbitrary local filesystem paths in MVP.
- Designing the optional web dashboard in this phase.

## Version lifecycle

`v26.0` is the MVP baseline as of 2026-08-18. Before an upgrade, inventory affected calls, validate endpoint and permission changes, update canonical fixtures and the OpenAPI contract, run read and validate-only checks, then prove one scoped pilot before rollout. Campaign daily/lifetime budgets, local monthly pacing budgets, and Meta spend/account limits remain distinct throughout.

## References

- [Meta Marketing API authorization](https://developers.facebook.com/docs/marketing-api/overview/authorization/)
- [Meta business-to-business asset management](https://developers.facebook.com/docs/marketing-api/business-asset-management/guides/business-to-business/)
- [Meta System Users](https://developers.facebook.com/docs/marketing-api/businessmanager/systemuser/)
- [Meta App Review](https://developers.facebook.com/docs/app-review/)
- [Meta Business Verification](https://developers.facebook.com/docs/development/release/business-verification/)
- [Meta access tokens](https://developers.facebook.com/docs/facebook-login/guides/access-tokens/)
- [Meta setup, pilot, and migration runbook](meta-setup.md)
- [Technology decisions](technology.md)
- [Secure remote access](remote-access.md)
- [OpenClaw slash commands and owner allowlist](https://docs.openclaw.ai/tools/slash-commands)
- [OpenClaw channel pairing](https://docs.openclaw.ai/channels/pairing)
- [OpenClaw plugins](https://docs.openclaw.ai/tools/plugin)
- [OpenClaw secrets management](https://docs.openclaw.ai/gateway/secrets)
