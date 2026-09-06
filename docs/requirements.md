# Product and system requirements

`fb-marketing-server` is a private, local Node.js HTTP service that lets an OpenClaw-backed administrative chat retrieve Meta Ads metrics and propose or manage ads without exposing Meta credentials to the model. Success means authorized reads are useful without approval, every mutation is human-controlled and auditable, and client ownership and authorization boundaries remain intact throughout migration to the agency integration.

## 1. Purpose and success outcome

### Scope

- Provide client- and Ad Account-scoped Meta Ads metrics, diagnostics, and budget pacing.
- Accept proposed ad mutations but execute them only after deterministic owner approval outside the LLM.
- Preserve and validate existing integrations while proving a central agency-owned integration through a pilot.
- Run as a private macOS service used only by OpenClaw.

### Confirmed decisions

- One global administrative chat may operate across all configured clients, while every request and response remains explicitly scoped to a client and Ad Account.
- Meta credentials remain inside `fb-marketing-server` and are never exposed to OpenClaw, the model, chat, or remote users.
- Reads execute after authorization without human approval; all mutations require one human approver through an owner-only deterministic OpenClaw command outside model dispatch.
- The target integration is an agency-owned Business App and System User in Business Portfolio `3981018332186282`; client assets remain client-owned and are shared through partner access.
- Phase 0 preserves all 14 existing Developer Apps. Migration occurs client by client only after pilot evidence and rollback readiness.
- The MVP uses macOS, a loopback-only Node.js service, SQLite, a LaunchAgent, and OpenClaw as its sole caller. It has no Docker, PostgreSQL, or web dashboard.
- The MVP pins Meta Graph/Marketing API `v26.0` as of 2026-08-18. Version upgrades are planned, compatibility-tested changes; callers cannot select a version.
- Campaign creation supports exactly `SALES_WEBSITE`, `LEADS_WEBSITE`, and `LEADS_INSTANT_FORM`. The product derives Meta objective, destination, optimization goal, billing event, and conversion event from that choice.

Implementation architecture, technology choices, Meta setup actions, and remote networking controls remain canonical in [Target architecture](architecture.md), [Technology decisions](technology.md), [Meta setup, pilot, and migration runbook](meta-setup.md), and [Secure remote access](remote-access.md).

## 2. Actors and system boundary

| Actor or system | Responsibility | Boundary |
|---|---|---|
| Global administrator | Uses one chat to request reads and propose changes across configured clients. | Cannot approve by natural-language intent. |
| Human approver | The single configured, channel-scoped owner who approves or rejects mutations. | Acts only through deterministic OpenClaw commands outside the LLM. |
| OpenClaw | Sole HTTP caller, chat interface, caller authentication boundary, and host of owner commands. | Must not receive Meta credentials. |
| `fb-marketing-server` | Resolves tenant context, authorizes integrations, reads Meta data, stores operations, and executes approved mutations. | Listens only on localhost. |
| Meta Marketing API | Supplies metrics and performs authorized ad operations. | Access is limited by the full effective-authority intersection defined in the architecture. |
| Client administrator | Grants or accepts partner access and shares required client-owned assets/tasks. | Retains client ownership; the agency cannot act unilaterally. |
| Agency administrator | Manages the agency app/System User and assigns partner-shared assets/tasks. | Cannot bypass client or Meta authorization controls. |

One legal client maps to one Business Portfolio. Agency centralization covers integration and operational control, not asset ownership.

## 3. Functional requirements

| ID | Requirement |
|---|---|
| FR-1 | Every Meta call and scoped operation shall explicitly resolve both an internal `client_id` and an external `ad_account_id`. The only unscoped discovery exceptions are authenticated `/health`, paginated `/v1/scopes`, and safe `/v1/integration-status` diagnostics. `/v1/scopes` returns authorized resolved client/account pairs and replaces separate client and Ad Account discovery. |
| FR-2 | Every response shall preserve any supplied `client_id` and `ad_account_id`. After successful resolution, it shall also label the resolved client and Ad Account. An error's `supplied_scope` shall preserve each supplied value exactly, without normalization or substitution, and shall not invent omitted values or resolved labels. For `GET /v1/capabilities`, `400`, `401`, `403`, and `409` forbid `resolved_scope`; its `409 client_account_mismatch` requires both query values in `supplied_scope`. |
| FR-3 | The service shall fail closed on missing, ambiguous, mismatched, or unauthorized client/account mappings without selecting another credential or tenant implicitly or accessing another client's assets. |
| FR-4 | Authorized metrics and diagnostics shall execute without human approval. Initial reports shall support spend, impressions, reach, clicks, CTR, CPC, CPM, results/conversions, cost per result, and ROAS when the required Meta data exists. A metric unavailable because of action type, attribution, permissions, or missing value data shall be labeled unavailable with an actionable reason rather than reported as zero. |
| FR-5 | The service shall support proposing complete campaign creation across Campaign, Ad Set, Creative, and Ad, plus edit/manage, activate, pause, resume, and budget-affecting mutations. Creation accepts only the three campaign kinds defined below and derives their fixed Meta combinations internally. The service validates supported local semantics, scoped assets, media, and mutation targets before persistence; owner approval remains mandatory. Successful creation returns Campaign, Ad Set, Creative, and Ad exactly once; Campaign, Ad Set, and Ad are created `PAUSED`, while Creative is created and bound without a delivery status. Activation requires a separate operation and approval. Delivery transitions apply only to Campaign, Ad Set, and Ad. |
| FR-6 | Creative images and videos shall originate only from the exact host-trusted inbound attachment bytes and metadata on the same OpenClaw event, never from model input, a model-supplied path or URL, or mutable latest-message state. `/stage-ad-media <client_id> <ad_account_id>` shall run deterministically in trusted inbound claim context outside model dispatch, require the configured single owner and authorized sender before file or HTTP access, accept exactly one fresh supported non-symlink attachment beneath an allowed root, and fail closed otherwise. `original_filename` is basename display metadata of 1..255 characters; slash, backslash, and control characters are rejected and it is never interpreted as a path. `fb-marketing-server` shall preserve explicit scope authorization, validate multipart fields, bytes, content and limits, hash bytes, bind media to scope and operation, and remove staged content after completion or expiry. |
| FR-7 | MVP read capabilities shall include `/v1/scopes`, safe integration status/diagnostics, campaign listing, Insights queries using FR-4 metrics, and monthly pacing for one explicit scope. OpenClaw may compose the global operational table by querying authorized scopes independently; no unscoped Meta report endpoint is exposed. Valid Insights queries with no data return `200` with an empty page; `422` is reserved for semantically unsupported queries or metrics. |
| FR-8 | For an explicit `client_id` and `ad_account_id`, the service shall expose discovery-only capabilities so the agent never guesses dynamic Meta IDs or options. One deterministic paginated `assets` collection, optionally filtered by asset type, shall discriminate Pages, pixels and web datasets using `pixel_id`, published/usable lead forms with `page_id`, and relevant Instagram Accounts. Every page shall repeat resolved identity, integration state, account metadata, exactly the three supported campaign kinds, capability statuses, and actionable secret-free gaps. Required `currency` and `timezone` keys may be null only when unavailable, each with its corresponding actionable gap; values shall never be fabricated. Every diagnostic code on an unavailable capability shall match exactly one `gaps[].code`. Dynamic IDs remain opaque and are revalidated at proposal creation and execution. Discovery shall not mutate Meta or local operation state or create, approve, or execute an operation. |
| FR-9 | The service shall return actionable integration status and diagnostics using `registered`, `validating`, `active`, `configuration_required`, `reauthorization_required`, or `asset_access_required`, including missing permissions when observable. |
| FR-10 | The service shall not rank clients or produce comparative cross-client analytics. It may return a global operational table whose rows report each Ad Account's budget status independently and identify its client. |
| FR-11 | Credential validation, state maintenance, and human reauthorization shall run through an internal scheduled or administrative mechanism outside the model-facing HTTP contract. It shall not assume standard OAuth refresh tokens, expose a credential-maintenance or public renewal endpoint, or reveal credentials. Safe integration status remains the only HTTP diagnostic view. |

### MVP campaign kinds

| Campaign kind | Internally derived Meta combination | Caller-supplied dynamic assets |
|---|---|---|
| `SALES_WEBSITE` | `OUTCOME_SALES` + `WEBSITE` + `OFFSITE_CONVERSIONS` + `IMPRESSIONS` + `PURCHASE` | Runtime-validated `pixel_id` and HTTPS website URL. |
| `LEADS_WEBSITE` | `OUTCOME_LEADS` + `WEBSITE` + `OFFSITE_CONVERSIONS` + `IMPRESSIONS` + `LEAD` | Runtime-validated `pixel_id` and HTTPS website URL. |
| `LEADS_INSTANT_FORM` | `OUTCOME_LEADS` + `ON_AD` + `LEAD_GENERATION` + `IMPRESSIONS` | Runtime-validated `page_id` and published `lead_gen_form_id`; form and page must match. |

Dynamic asset IDs remain opaque strings validated at runtime. CTA validation uses a schema union plus runtime campaign-kind validation: Sales allows `SHOP_NOW`, `BUY_NOW`, `ORDER_NOW`, `ADD_TO_CART`, `LEARN_MORE`, `GET_OFFER`, `SUBSCRIBE`; Leads allows `LEARN_MORE`, `SIGN_UP`, `APPLY_NOW`, `GET_QUOTE`, `CONTACT_US`, `BOOK_NOW`, `SUBSCRIBE`, `GET_STARTED`. Advantage+, bid strategies, attribution-window controls, messaging, calls, catalogs, apps, omnichannel, `QUALITY_LEAD`, and `VALUE` are outside MVP.

## 4. Budget pacing requirements and formulas

For one Ad Account and currency:

| ID | Requirement or formula |
|---|---|
| FR-12 | Store a fixed monthly budget locally for each Ad Account and obtain its month-to-date (`MTD`) spend from Meta Insights. Use that Ad Account's Meta-configured timezone for reporting-month boundaries. If timezone is unavailable, retain currency and monthly budget while explicitly returning `reporting_month` and every timezone-dependent or derived pacing field unavailable with reason `timezone_unavailable`; the service shall never fabricate a month. Otherwise calculate linear pacing from exact elapsed time. |
| FR-13 | Return the client, Ad Account, monthly budget, MTD spend, remaining budget, pacing progress, expected spend to date, variance, projected month-end spend, `linear_elapsed_time` pacing policy, and Ad Account timezone. |
| FR-14 | `remaining = monthly_budget - MTD_spend`; negative values remain visible. `expected_spend_to_date = monthly_budget * elapsed_fraction` and, when timezone is known, remains available even if MTD spend is unavailable; `variance = MTD_spend - expected_spend_to_date`; and `projected_month_end_spend = MTD_spend / elapsed_fraction` when positive. At exact month start, `elapsed_fraction` and expected spend are zero and only projection is unavailable. |
| FR-18 | Monetary calculations shall use decimal-safe handling, preserve source currency, and round to the ISO 4217 minor unit with round-half-even. Ratios, rates, and fractions shall round to 6 decimal places with round-half-even. Different currencies shall never be silently summed or compared. |
| FR-19 | Campaign daily/lifetime budgets, account spend limits, and fixed monthly pacing budgets shall remain distinct concepts in storage and output. |

The budget scope is one fixed monthly budget per Ad Account. Each account's Meta-configured timezone defines its reporting-month boundaries, and pacing follows a linear exact-elapsed-time policy.

## 5. Security and authorization requirements

| ID | Requirement |
|---|---|
| SEC-1 | `fb-marketing-server` shall bind only to `127.0.0.1` and accept requests only from OpenClaw carrying a valid dedicated internal service credential. |
| SEC-2 | User access shall terminate at configured OpenClaw outbound chat channels; both local APIs shall remain loopback-only. Tailscale or SSH may provide authenticated administrative shell access to the Mac only. |
| SEC-3 | Meta access tokens, App Secrets, service credentials, encryption keys, and authorization headers shall not appear in responses, logs, audit records, prompts or tool context, traces, chat, or source control. |
| SEC-4 | Meta tokens shall be encrypted at rest with a key held in macOS Keychain and separate from the database. |
| SEC-5 | Exactly one configured channel-scoped owner identity shall approve or reject operations after OpenClaw establishes sender authorization. The LLM shall not possess or invoke this authority. |
| SEC-6 | A pending operation shall be valid only while `now < created_at + 12 hours`; at equality it is expired. Approval shall be single-use, idempotent, and bound to the exact immutable operation payload and integration generation. Immediately before execution, the service shall revalidate the target, budget, authority, credential generation, and bound media hash. Only semantic target mismatch or not-found may make an operation stale; retryable, transient, and upstream revalidation failures shall preserve its prior lifecycle state and supported HTTP status/`Retry-After` semantics. Approval decisions and execution outcomes shall be separately auditable. |
| SEC-7 | A Meta call shall proceed only when app access, token validity and scopes, subject authority, partner relationship, asset assignment/tasks, and endpoint requirements authorize the resolved client and asset. |
| SEC-8 | Missing authority shall produce actionable feedback and shall never trigger a permission bypass, cross-client fallback, or silent credential substitution. |
| SEC-9 | Client Business Assets shall remain owned by their client portfolio; agency access shall use explicit partner sharing and least-required asset tasks. |

## 6. Data and persistence requirements

| ID | Requirement |
|---|---|
| NFR-1 | SQLite shall provide local persistence with WAL mode, foreign-key enforcement, and transactions for multi-record state transitions. |
| NFR-2 | Persisted records shall maintain stable mappings among legal clients, Business Portfolios, Ad Accounts/assets, integrations, credential metadata, and integration generations. |
| NFR-3 | Pending operations shall be immutable. Approval, rejection, expiry, execution, and failure shall be separate state records or append-only events linked to the operation. |
| NFR-4 | Every Meta API call, including reads, diagnostics, credential maintenance, and mutations, shall append an immutable, append-only audit record identifying actor, resolved client/account, integration generation, logical operation, correlation ID, timestamp, normalized outcome/error, and redacted external evidence. It shall not store tokens, secrets, authorization headers, or complete request/response bodies. Mutation entries shall additionally link the pending operation, approval decision, and execution. |
| NFR-5 | Credential records shall retain ciphertext or a protected reference plus app/subject binding, scopes, lifecycle state, validation timestamps, and revocation evidence, never plaintext tokens. |
| NFR-6 | Backups shall be protected to the same standard as live data and shall have a documented, tested restore procedure. |
| NFR-8 | Operation idempotency shall bind the key to authenticated caller, operation type, client/account, and canonical payload hash. Same key and payload returns the existing operation; a different payload returns `409 idempotency_conflict`. The key remains reserved with immutable operation and audit history. Pagination cursors bind the authenticated caller, client/account scope where applicable, and a hash of all filters, including capability asset type; mismatched reuse returns `400`. |

## 7. Operational and migration requirements

| ID | Requirement |
|---|---|
| FR-20 | Phase 0 shall inventory all 14 existing Developer Apps, including the five associated with one client, without deleting, consolidating, revoking, or repointing them. |
| FR-21 | Each integration shall have one actionable state supported by redacted validation evidence and explicit client, app, credential subject, permission, asset, and rollback mappings. |
| FR-22 | The agency target shall use a new central Business App and System User owned by Business Portfolio `3981018332186282`, after applicable Meta verification, review/access, scope, task, and endpoint requirements are evidenced. |
| FR-23 | Existing app-bound tokens shall not be treated as transferable to the central app. Replacement authority shall be provisioned and validated independently. |
| FR-24 | The pilot shall use Business Portfolio `290166249089842` and validate its two Ad Accounts independently for asset access, metrics, and diagnostics. |
| FR-25 | Pilot completion shall include one low-risk reversible mutation and its rollback, each executed through the approval controls and verified for at-most-once behavior. |
| FR-26 | Client migration shall occur one client at a time. Before cutover, mutations for that scope shall be frozen and pending/in-flight work reconciled against its bound integration generation. |
| FR-27 | A migrated client shall retain the prior integration as a rollback path for at least 7 days after reconciled cutover and successful replacement validation. Retirement also requires replacement authority, required endpoints, approved mutations, audit evidence, and exit checks to pass. |
| NFR-7 | A per-user macOS LaunchAgent shall start the service at login; application logs shall be written under `~/Library/Logs/fb-marketing-server/`. |

The operational procedure and evidence checklist are defined in the [Meta setup runbook](meta-setup.md); this document does not duplicate changing Meta dashboard steps.

## 8. Non-functional requirements

| ID | Requirement |
|---|---|
| NFR-9 | Mutation processing shall remain correct across retries, process restarts, approval replay, and integration cutover. |
| NFR-10 | Responses and operator diagnostics shall be concise, actionable, and consistently identify client, account, integration state, and remediation category without revealing secrets. |
| NFR-12 | Audit and backup data shall remain locally operable and recoverable without requiring Docker, PostgreSQL, or a web dashboard. |

## 9. Acceptance criteria

| ID | Acceptance criterion | Traces to |
|---|---|---|
| AC-1 | Requests lacking either ID, or containing a mismatched mapping, fail before a Meta call. Errors preserve every supplied `client_id` and `ad_account_id` and identify the resolution failure without claiming resolved labels; successful responses identify both resolved values. | FR-1, FR-2, FR-3 |
| AC-2 | An authorized metrics request for each pilot Ad Account succeeds without approval and returns the explicitly requested account with spend, impressions, reach, clicks, CTR, CPC, CPM, results/conversions, cost per result, and ROAS where available; unavailable metrics carry a reason and are not coerced to zero. Neither account can resolve through the other's mapping, and each Meta call appends redacted audit metadata with its correlation ID and outcome. | FR-4, FR-24, SEC-7, NFR-4 |
| AC-3 | A complete Campaign/Ad Set/Creative/Ad creation, edit/manage, activate, pause, resume, or budget-affecting request creates an immutable pending operation and cannot execute from model output or natural-language consent. An approved complete creation creates Campaign, Ad Set, and Ad in `PAUSED` delivery state and creates and binds the Creative without that delivery status; a different approved operation is required to activate delivery. | FR-5, SEC-5, NFR-3 |
| AC-4 | Owner approval executes the exact stored payload once only while `now < created_at + 12 hours` and after successful target, budget, authority, credential-generation, and media-hash revalidation; at equality the operation is expired. Duplicate, expired, rejected, changed, completed, replayed, stale, or generation-mismatched attempts do not execute. Idempotency key and cursor binding rules reject mismatched reuse and preserve immutable history across restart. | SEC-6, NFR-3, NFR-4, NFR-8, NFR-9 |
| AC-5 | Fixed fixtures reproduce pacing across ordinary, month-boundary, daylight-saving, and zero-progress cases with deterministic rounding. Missing timezone retains currency and monthly budget while explicitly marking reporting month and every timezone-dependent or derived value unavailable with reason `timezone_unavailable`. With timezone known and MTD spend unavailable, expected spend remains available while spend-dependent values are unavailable. At exact month start progress and expected spend are zero and only projection is unavailable; overspend remains negative and currencies are not combined. | FR-12, FR-13, FR-14, FR-18, FR-19 |
| AC-6 | Credential validation, diagnostics, state updates, and human reauthorization return concise integration state and remediation labels for missing app configuration, invalid credentials, missing permissions, or absent partner/asset assignment, without public renewal, fallback, or secret disclosure. | FR-9, FR-11, SEC-7, SEC-8, NFR-10 |
| AC-7 | In an isolated stubbed run, inject unique canary values for a Meta token, App Secret, service credential, encryption key, and authorization header; exercise successful, failed, diagnostic, proposal, approval, and audit paths; then exact-match scan responses, logs, audit records, prompts/tool context, traces, chat output, and repository files and find none of the canaries. Persisted credential inspection finds only ciphertext or protected references, with the key absent from the database. | SEC-3, SEC-4, NFR-5 |
| AC-8 | Network inspection confirms `fb-marketing-server` listens only on loopback, rejects a missing or invalid service credential, and is reached remotely only through the authenticated OpenClaw boundary. | SEC-1, SEC-2 |
| AC-9 | Phase 0 inventory contains all 14 existing apps with actionable state and rollback data; persisted client, portfolio, account/asset, integration, credential-metadata, and generation mappings reload unchanged; no app is altered or retired. | FR-20, FR-21, NFR-2 |
| AC-10 | Evidence shows the central Business App and System User belong to agency portfolio `3981018332186282`, while pilot assets remain owned by portfolio `290166249089842` and use explicit partner sharing with least-required tasks. Both pilot Ad Accounts then pass separate access, metrics, and diagnostics, followed by one approved reversible mutation and approved rollback with complete audit linkage. | FR-22, FR-24, FR-25, SEC-9, NFR-4 |
| AC-11 | A migration cutover cannot reuse old app-bound tokens or move pending operations to a new generation; the previous integration remains available for at least 7 days after reconciled cutover and successful validation, and cannot retire until exit evidence passes. | FR-23, FR-26, FR-27 |
| AC-12 | The per-user LaunchAgent starts the loopback service at login and writes redacted logs under `~/Library/Logs/fb-marketing-server/`; SQLite uses WAL and foreign keys, approval/execution transitions are transactional, and protected audit and backup data restore and remain operable locally without Docker, PostgreSQL, or a dashboard. | NFR-1, NFR-6, NFR-7, NFR-12 |
| AC-13 | OpenClaw composes a global budget table from `/v1/scopes` and one scoped pacing request per pair. Each row remains independent, with no rankings, comparative scores, or cross-currency aggregation. | FR-1, FR-2, FR-10, FR-18 |
| AC-14 | An authorized single owner can send `/stage-ad-media <client_id> <ad_account_id>` with exactly one same-event JPEG, PNG, or MP4; its host-trusted bytes are copied into private staging, content-validated, hashed, and scope-bound without model execution or mutable message bridging. Unauthorized, missing, multiple, unsupported, oversized, mismatched, expired, out-of-root, symlink, model-path, or model-URL inputs fail before file or HTTP access as applicable, and staged files are removed after completion or expiry. | FR-5, FR-6, SEC-3 |
| AC-15 | Against pilot fixtures, the API returns redacted integration status and diagnostics, both authorized pairs through `/v1/scopes`, campaign listings scoped independently to each requested account, and the full FR-4 Insights metric set with unavailable reasons rather than zero substitution. Where Meta data and local budget configuration exist, OpenClaw composes a global pacing table from one scoped pacing response per pair. | FR-1, FR-4, FR-7, FR-10, FR-12, FR-13, FR-14, FR-18, FR-19 |
| AC-16 | Exercising reads, diagnostics, credential maintenance, and mutations proves every Meta call appends an immutable, append-only audit record containing actor, resolved client/account, integration generation, logical operation, correlation ID, timestamp, normalized outcome/error, and redacted external evidence. Record inspection confirms tokens, secrets, authorization headers, and complete request/response bodies are excluded; mutation records link the operation, approval decision, and execution. | NFR-4 |
| AC-17 | For each authorized pilot pair, page `GET /v1/capabilities` with cursor, limit, and each asset-type filter. Assets have deterministic order and the correct discriminator; pixels/web datasets use `pixel_id`, lead forms are published/usable and include `page_id`. Every page repeats identity, integration/account metadata, the three campaign kinds, capability statuses, and gaps. Cursor reuse under another caller, scope, or filter returns `400`. Null currency/timezone has its required actionable gap and no fabricated value. Every unavailable capability diagnostic code matches exactly one `gaps[].code`; missing permissions are unique safe permission names. Capability `400/401/403/409` responses preserve supplied query values exactly and contain no `resolved_scope`; mismatch `409` contains both IDs. Discovery performs no mutation, and proposal plus execution revalidate selected opaque IDs. | FR-1, FR-2, FR-3, FR-8, SEC-3, SEC-7, SEC-8, NFR-4, NFR-8 |

## 10. Explicit non-goals

- Any user-facing network exposure of `fb-marketing-server` or a public token-renewal endpoint.
- Exposing Meta credentials to OpenClaw, models, chat, logs, or users.
- A standard OAuth refresh-token assumption for Meta System User credentials.
- Transfer of client asset ownership to the agency portfolio.
- Deleting or consolidating existing Developer Apps during Phase 0 or foundation work.
- Bypassing Meta permissions, verification, review/access, partner sharing, asset assignment, or task requirements.
- Ranking clients, comparative cross-client analytics, or silent cross-currency aggregation.
- Deleting ads or other managed ad objects in MVP.
- Google Drive ingestion, arbitrary remote media URLs, and arbitrary local filesystem paths in MVP.
- Docker, PostgreSQL, or a web dashboard in MVP. A separate approval/admin dashboard may be considered after MVP without weakening the approval model.
- Prescribing exact Meta dashboard navigation, framework internals, an ORM, or requirements not demonstrated by the chosen endpoints.

## 11. References

- [Target architecture and phased delivery](architecture.md)
- [Technology decisions](technology.md)
- [Meta setup, pilot, and migration runbook](meta-setup.md)
- [Secure remote access](remote-access.md)
