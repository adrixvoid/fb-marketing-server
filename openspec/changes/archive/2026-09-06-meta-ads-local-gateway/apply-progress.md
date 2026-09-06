# Apply Progress: Meta Ads Local Gateway

## Mode

- Initial Unit 1 batch: Standard Mode because the repository began without a runner and cached `strict_tdd: false`.
- Unit 1 audit remediations: Strict TDD Mode with `npm test`; previous progress was read and merged before each remediation.
- Unit 2 SQLite/security foundation: Strict TDD Mode with `npm test`; cumulative filesystem and Engram progress were read before implementation.
- Unit 2 security review remediation: Strict TDD Mode with `npm test`; review FAIL findings were reproduced before production changes and all prior evidence was retained.
- Unit 2 focused review remediation: Strict TDD Mode with `npm test`; five timeout, authenticity, cleanup, permission, and budget findings were reproduced before production changes.
- Unit 3 Meta reads/reporting/pacing: Strict TDD Mode with `npm test`; task 3.1 was implemented first with native-fetch fixtures and no Unit 4+ work.
- Unit 3 review remediation: Strict TDD Mode with `npm test`; all ten fresh-review findings were reproduced before production changes, prior evidence was merged, and Unit 4 remained untouched.
- Unit 4 media/proposals/approval: Strict TDD Mode with `npm test`; each task began with missing-module/schema/route RED evidence, prior progress was merged, and Unit 5+ remained untouched.
- Unit 4 confirmed review remediation: Strict TDD Mode with `npm test`; all 15 confirmed findings were reproduced before their fixes, cumulative history was preserved, and Unit 5+ remained absent.
- Unit 4 approval review remediation: Strict TDD Mode with `npm test`; all three fresh approval warnings were reproduced before production changes, cumulative history was preserved, and Unit 5+ remained absent.
- Unit 4 approval body-binding remediation: Strict TDD Mode with `npm test`; raw chunked approval/rejection bodies reproduced the decision-commit bypass before the framing guard, cumulative history was preserved, and Unit 5+ remained absent.
- Unit 4 PNG structure remediation: Strict TDD Mode with `npm test`; a valid-CRC duplicate `IHDR` after `IDAT` reproduced the structural-validation gap before the minimal chunk state machine, cumulative history was preserved, and Unit 5+ remained absent.
- Unit 5 campaign execution/reconciliation: Strict TDD Mode with `npm test`; migration, executor, approval/runtime composition, media reads, multipart video transport, safe restart, and ambiguous-write tests were RED before production changes. Unit 6 remains absent.
- Unit 5 execution-history remediation: Strict TDD Mode with `npm test`; fresh review reproduced incomplete successful-step evidence and mutable terminal execution timestamps before hardening migration v5.
- Unit 5 confirmed review remediation: Strict TDD Mode with `npm test`; all 15 confirmed findings received focused regression coverage before the minimal production fixes, while Unit 6 remained absent and acceptance remained review-gated.
- Unit 5 SQLite/reconciliation remediation: Strict TDD Mode with `npm test`; fresh direct-SQL reproductions covered predecessor bypass, nullable result validation, v5 evidence mutation, auditless history, and weak crash assertions before migration v7 hardening. Meta wire and security/contract behavior remained unchanged.
- Unit 5 migration-v8 incident remediation: Strict TDD Mode with `npm test`; direct-SQL RED probes reproduced nullable step-audit links and forged successful/failed resource evidence before a distinct fail-closed v8 rebuild. The terminal-execution invariant remained enforced and Unit 6 stayed absent.
- Unit 5 dependency-security remediation: Strict TDD Mode with `npm audit`; vulnerable transitive resolutions were confirmed before the targeted lockfile-only update. No parent dependency, direct dependency, override, or Unit 6 work was added.
- Unit 6 OpenClaw/launchd/migration: Strict TDD Mode with `npm test`; plugin, native operations, and migration checks began with missing modules or absent progress evidence, use only fake/local boundaries, and retain all prior work-unit evidence.
- Failed-verification CRITICAL remediation: Strict TDD Mode with real plugin-to-Fastify integration; only the two findings from evidence `sha256:a78b5084815826165f4581874290be1daf480c19c1f70cf0bd4806c6e9d8f714` are in scope.

## Completed Tasks

- [x] 1.1 Created and remediated the Node 24 package/lockfile/TypeScript scaffold. Build executes schema/drift compilation; only Unit 1 runtime dependencies remain, and `@types/node` is pinned to major 24.
- [x] 1.2 Added and remediated contract generation, Fastify/openapi-backend plumbing, loopback/bearer gates, explicit disabled multipart behavior, direct AJV 2020 request/response validation, exact status/media/header fail-closed handling, protected infrastructure callbacks, declared and validated normalized internal errors, and RFC 9457 errors.
- [x] 1.3 Re-detected and persisted test/typecheck/build/drift capabilities. Strict TDD remains enabled for future batches.
- [x] 2.1 Added transactional and version-guarded `user_version` migration v1, exact ownership/currency-safe minor-unit budgets, synchronous-only transactions, failure-safe initialization, and trusted-root atomic backups authenticated against canonical schema.
- [x] 2.2 Added bounded stdin-only Keychain creation, non-destructive key get-or-create, versioned identity-bound AES-256-GCM envelopes, complete credential lifecycle scope gates, and strictly validated append-only audit metadata.
- [x] 3.1 Added a fixed-v26.0 native-fetch Meta client with just-in-time bearer credentials and HMAC proof, per-attempt redacted audits, timeout aborts, bounded GET-only retries, rate evidence, safe cursor pagination, and create-once async Insights polling.
- [x] 3.2 Added safe scope/integration discovery, HMAC-bound deterministic cursors, repeated-context capabilities, scoped campaign reads, typed unavailable Insights metrics, account isolation, and OpenAPI-valid handler adapters.
- [x] 3.3 Added exact Temporal month windows and decimal half-even pacing, ISO 4217 minor-unit formatting, missing-timezone/spend variants, negative overspend, scoped MTD Insights reads, and an OpenAPI-valid pacing handler.
- [x] 4.1 Added streamed trusted-attachment staging with `file-type`, private atomic storage, scope/hash/expiry binding, cleanup, audit, and production route wiring.
- [x] 4.2 Added canonical immutable typed proposals, permanent idempotency, constrained media links, three fixed campaign mappings, runtime asset/target checks, and correlated handlers.
- [x] 4.3 Added deterministic owner-only HMAC proof, replay persistence, exact expiry, approval/rejection revalidation and state transitions, terminal media cleanup, and linked immutable audit.
- [x] 5.1 Added migration-v5 execution/step/audit persistence, atomic approved-pending claims, image/video upload, ordered paused campaign bundles, typed updates/delivery/local budgets, execution-time expiry/staleness handling, and approval/runtime composition.
- [x] 5.2 Added restart reconciliation that resumes only persisted successful steps, finalizes committed local steps, converts orphaned intent to reconciliation-required, and never redispatches an ambiguous write.
- [x] 6.1 Added the installable OpenClaw `2026.9.2` plugin with exactly nine scoped tools, trusted attachment context, loopback-only gateway access, and no model approval tools.
- [x] 6.2 Added deterministic owner commands, exact replay-safe proof generation, Keychain-only production startup, an atomic user LaunchAgent installer, graceful signals, documented operations, and runnable protected database commands.
- [x] 6.3 Added and fixture-tested a strict 14-app/pilot-first migration manifest, append-only private redacted evidence, deterministic rollout gates, seven-day observation/rollback validation, and machine-readable local commands. Real rollout remains operator work.

## Initial Unit 1 Verification

| Command | Result |
|---|---|
| `npm install` | Passed; original scaffold installed |
| `npm run generate` | Passed; original runtime artifact generated |
| `npm run generate:check` | Passed |
| `npm run typecheck` | Passed |
| `npm run build` | Passed |
| `npm test` | Passed; original 5 tests |

## First Unit 1 Remediation — Strict TDD Cycle Evidence

| Remediation | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| Exact documented error and success response validation | `test/app.test.ts` | Integration | ✅ baseline `npm test`: 5/5 | ✅ invalid problem remained 401 and invalid success remained 200 | ✅ relevant response probes passed | ✅ invalid error, invalid success, missing status, and actual media mismatch | ✅ centralized response path remained green |
| AJV 2020 closure and JSON request validation | `test/openapi-validation.test.ts`, `test/app.test.ts` | Unit + Integration | ✅ baseline 5/5 | ✅ validator test failed `ERR_MODULE_NOT_FOUND` before the validator existed | ✅ validator and request integration passed | ✅ valid/extra closure, unknown format, invalid request body | ✅ shared ref compiler remained green |
| Parser/error and unsupported-method normalization | `test/app.test.ts` | Integration | ✅ baseline 5/5 | ✅ malformed JSON was raw, OPTIONS was 404, unsupported media was 500 | ✅ normalized 400/405 problems | ✅ separate malformed JSON and media paths | ✅ one secret-free normalizer |
| Deterministic generated artifacts and schema compilation | `test/generation.test.ts` | Integration | ✅ prior drift passed | ✅ missing `openapi.d.ts` produced `ENOENT` | ✅ generated outputs and drift passed | ✅ generated types plus runtime-only options | ✅ one schema-compiling generator |
| Disabled multipart trust boundary | `test/app.test.ts` | Integration approval | ✅ prior multipart passed | ➖ No behavior change | ✅ multipart and model path/URL return 422 without ingestion | ✅ two boundary inputs | ➖ Full ingestion remains task 4.1 |
| Dependency/build hygiene | `package.json`, `package-lock.json` | Structural | ✅ original install/build passed | ✅ audit exposed future dependencies, Node 26 typings, and missing build drift | ✅ install/audit/build passed | ➖ Structural configuration | ✅ retained current-slice dependencies only |

## Second Unit 1 Remediation — Strict TDD Cycle Evidence

| Remediation | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| Case-insensitive actual media selection | `test/app.test.ts` | Integration | ✅ 18/18 | ✅ mixed-case `Content-Type` returned 200 | ✅ exact probe passed | ✅ lowercase and mixed-case with charset | ✅ normalized validation/transmission headers |
| Project-required response headers | `test/app.test.ts` | Integration | ✅ 18/18 | ✅ missing `X-Request-ID` returned 200 | ✅ normalized 500 with generated ID | ✅ mixed-case valid and short invalid values | ✅ shared AJV header validators |
| Protected infrastructure callbacks | `test/app.test.ts` | Integration | ✅ 18/18 | ✅ injected `postResponseHandler` bypassed validation | ✅ invalid operation response returns 500 | ✅ legitimate operation overrides preserved | ✅ defaults → operation overrides → protected handlers |

## Third Unit 1 Remediation — Strict TDD Cycle Evidence

| Remediation | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| Declared and validated normalized 500 | `test/app.test.ts` | Integration | ✅ `npm test`: 23/23 | ✅ normalized response produced no observable exact 500 validation | ✅ one exact 500 `application/problem+json` validation succeeds | ✅ invalid original response followed by valid normalized 500 | ✅ internal error candidate validates exactly once without recursion |
| Reusable InternalError contract | `test/internal-error-contract.test.ts` | Structural integration | ✅ 23/23 | ✅ operations had no reusable 500 response | ✅ all 12 operations reference `#/components/responses/InternalError` | ✅ response header, media schema, and stable `internal_error` code checked | ✅ one response and one problem schema reused everywhere |
| Invalid internal-error emergency path | `test/app.test.ts` | Integration | ✅ 23/23 | ✅ controlled invalid internal error still transmitted as problem JSON | ✅ invalid candidate produces observable secret-free text emergency response | ✅ missing header and invalid body exercised together | ✅ emergency path does not recurse or claim contract validity |
| Hybrid filesystem persistence | `test/apply-progress.test.ts` | Structural integration | ✅ Engram #1558 contained prior history | ✅ filesystem read failed `ENOENT` | ✅ cumulative OpenSpec progress is readable | ✅ verifies all three remediation histories and 3/16 state | ➖ Artifact materialization only |

## Unit 2 — Strict TDD Cycle Evidence

> This initial Unit 2 cycle established the foundation but later failed fresh security review. The remediation cycle below is authoritative for acceptance.

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| SQLite migrations and transaction safety | `test/db.test.ts` | Persistence integration | ✅ baseline `npm test`: 27/27 | ✅ missing `src/db.ts` and `src/migrations.ts` failed module resolution | ✅ migration, FK, rollback, and restart probes passed | ✅ idempotency, failed DDL rollback, interrupted writes, and file restart | ✅ one numbered transactional migration runner |
| Protected backup and restore | `test/db.test.ts` | Persistence integration | ✅ baseline 27/27 | ✅ persistence modules absent | ✅ native SQLite backup restored a usable database | ✅ live snapshot, restored read, WAL reopen, and `0600` file protection | ✅ reused Node's built-in `backup()` API |
| Keychain and credential encryption | `test/security.test.ts` | Security unit + integration | ✅ baseline 27/27 | ✅ missing `src/secrets.ts` failed module resolution | ✅ fixed executable/argument adapter and AES-256-GCM probes passed | ✅ correct identity, mismatched AAD, tampered tag, and ciphertext persistence | ✅ one provider interface; no new dependency |
| Explicit isolated scope | `test/security.test.ts` | Persistence integration | ✅ baseline 27/27 | ✅ missing `src/scope.ts` failed module resolution | ✅ authorized pair resolved and mismatch failed before callback | ✅ active mapping/generation/credential, task, permission, and mismatched client | ✅ one prepared scope query with no fallback |
| Append-only redacted audit | `test/security.test.ts` | Security integration | ✅ baseline 27/27 | ✅ audit implementation absent | ✅ allowlisted evidence persisted; update/delete rejected | ✅ token, App Secret, service credential, key, authorization, and body canaries excluded | ✅ DB triggers enforce immutability |
| Unit 2 progress persistence | `test/apply-progress.test.ts` | Structural integration | ✅ Unit 1 cumulative evidence passed | ✅ expected Unit 2 evidence and 5/16 state were absent | ✅ cumulative progress includes Unit 2 | ✅ prior Unit 1 history remains asserted | ➖ Artifact materialization only |

## Unit 2 Security Review Remediation — Strict TDD Cycle Evidence

| Remediation | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| Keychain argv/error confinement | `test/security.test.ts` | Security unit | ✅ baseline `npm test`: 34/34 | ✅ test required secret-free argv, stdin bytes, and serialized failure; `getOrCreateEncryptionKey` export was absent | ✅ security probes 8/8 | ✅ successful create/read plus raw child failure canary | ✅ one no-shell `spawn` runner; stderr/raw causes discarded |
| Non-destructive key creation | `test/security.test.ts` | Security unit | ✅ 34/34 | ✅ prior API always updated the key | ✅ repeated get-or-create preserves decryptability | ✅ missing key creation and existing key reuse | ✅ rotation remains a separate future concern |
| Versioned strict crypto envelope | `test/security.test.ts` | Security unit | ✅ 34/34 | ✅ malformed base64, wrong sizes, and unsupported versions were accepted or unversioned | ✅ security probes 8/8 | ✅ append junk, empty ciphertext, IV/tag sizes, version, identity, and tag tamper | ✅ one canonical base64 parser and version-bound AAD |
| Transaction and migration guards | `test/db.test.ts` | Persistence integration | ✅ 34/34 | ✅ async callback committed its insert; negative/newer versions were not rejected correctly | ✅ DB probes 8/8 | ✅ thrown and promise-like callbacks; `-1` and `99` versions | ✅ synchronous-only TypeScript result type plus runtime thenable guard |
| Trusted-root backup/restore | `test/db.test.ts` | Filesystem + persistence integration | ✅ 34/34 | ✅ traversal/symlink/existing destinations and source symlinks were accepted | ✅ DB probes 8/8 | ✅ outside paths, root/target symlinks, existing target, corruption, cleanup, restart | ✅ one trusted-path gate and one temp/verify/atomic-publish path |
| Minimal ownership-safe migration v1 | `test/db.test.ts` | Schema integration | ✅ 34/34 | ✅ future Unit 4/5 tables remained and c1→c2 mapping succeeded | ✅ exact eight-table schema and composite ownership FK pass | ✅ exact retained schema, orphan account, and cross-client mapping | ✅ deleted premature tables/triggers; future tables deferred |
| Scope credential lifecycle | `test/security.test.ts` | Persistence integration | ✅ 34/34 | ✅ unvalidated/revoked credentials and retired generations resolved | ✅ security probes 8/8 | ✅ null validation, revocation, inactive credential/integration, retired generation | ✅ lifecycle predicates remain centralized in one prepared query |
| Audit validation and invariants | `test/security.test.ts` | Security + schema integration | ✅ 34/34 | ✅ nested authorization object and serialized/token-shaped variants reached persistence | ✅ security probes 8/8 | ✅ objects, arrays, unknown keys, types, controls, secret shapes, empty fields, illegal outcome, partial/orphan scope | ✅ explicit primitive validators plus DB checks/composite FK/immutability triggers |
| Current-surface canary confinement | `test/security.test.ts` | Security integration | ✅ 34/34 | ✅ prior scan did not execute child failure, nested audit, scope serialization, or WAL paths | ✅ all current probes execute and DB/WAL/output scans pass | ✅ token, App Secret, service credential, key, and authorization canaries | ✅ prompts/tools/chat and future operation paths are explicitly deferred to their owning units |
| Remediation progress persistence | `test/apply-progress.test.ts` | Structural integration | ✅ prior cumulative progress passed | ✅ remediation section was absent | ✅ cumulative artifact includes both original and remediation cycles | ✅ Unit 1, initial Unit 2, remediation, and 5/16 state | ➖ Artifact materialization only |

## Unit 2 Focused Review Remediation — Strict TDD Cycle Evidence

| Remediation | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| Keychain timeout/no-hang | `test/security.test.ts` | Security unit | ✅ baseline `npm test`: 43/43 | ✅ never-resolving runner exceeded the 200 ms test guard with no abort | ✅ security probes 9/9 | ✅ timeout abort plus successful completion proves timer clearing | ✅ one bounded runner wrapper; 10 s default and injected short tests |
| Backup schema authenticity | `test/db.test.ts` | Persistence integration | ✅ 43/43 | ✅ counterfeit eight-table/version-1 database restored successfully | ✅ DB probes 12/12 | ✅ counterfeit tables plus altered trigger, index, and FK | ✅ SHA-256 over normalized schema and explicit column/FK/index metadata; no restore recursion |
| Failed initialization cleanup | `test/db.test.ts` | Filesystem integration | ✅ 43/43 | ✅ 40 rejected version-99 opens grew `/dev/fd` by 81 | ✅ repeated failures remain within six descriptors | ✅ normal open/restart and repeated failure paths | ✅ one initialization try/catch closes without masking the original error |
| Backup in-flight permissions | `test/db.test.ts` | Filesystem + persistence integration | ✅ 43/43 | ✅ no in-flight permission callback executed | ✅ observed destination/temp DB `0600` and temp directory `0700` during backup | ✅ in-flight and final publication plus cleanup | ✅ destination and temp DB are reserved before SQLite writes; no global umask change |
| Exact owned budgets | `test/db.test.ts` | Schema integration | ✅ 43/43 | ✅ `amount_minor` was absent and arbitrary text/currency mismatch remained possible | ✅ exact minor-unit storage passes | ✅ `banana`, negative, overflow, EUR-for-USD, and valid USD probes | ✅ one INTEGER/CHECK and one composite account/currency FK |
| Focused remediation progress | `test/apply-progress.test.ts` | Structural integration | ✅ prior cumulative progress passed | ✅ focused remediation section was absent | ✅ cumulative evidence now includes all Unit 1/2 cycles | ✅ prior sections and 5/16 state retained | ➖ Artifact materialization only |

## Final Unit 2 Retained Schema

- `clients`
- `integrations`
- `integration_generations`
- `ad_accounts`
- `scope_mappings`
- `encrypted_credentials`
- `budgets`
- `audit_log`

Staged media, pending operations, approvals, execution state/steps, and proof nonces are deferred to their owning Unit 4/5 tasks and migrations.

`budgets.amount_minor` is a nonnegative integer capped at `Number.MAX_SAFE_INTEGER`; its `(ad_account_id, client_id, currency)` foreign key must match the owned Ad Account. External decimal-string conversion remains deferred to reporting/pacing.

## Unit 3 — Strict TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 3.1 Audited Meta reads and async Insights transport | `test/meta-client.test.ts` | Unit with fake fetch | ✅ baseline `npm test`: 48/48 | ✅ missing `src/meta-client.ts` failed module resolution | ✅ 6/6 focused tests passed | ✅ success/error, credential-query rejection, GET retry/POST no-retry, malformed/timeout, finite/looping pages, completed/exhausted jobs | ✅ centralized reserved-query rejection and shared normalization helpers remained green |
| 3.1 Hybrid progress persistence | `test/apply-progress.test.ts` | Structural integration | ✅ prior cumulative progress passed | ✅ Unit 3 evidence and 6/16 state were absent | ✅ cumulative progress includes task 3.1 | ✅ prior Unit 1/2 sections remain asserted | ➖ Artifact materialization only |
| 3.2 Scoped discovery, capabilities, campaigns, and Insights | `test/reporting.test.ts` | Unit + Fastify integration | ✅ task 3.1 focused checks green | ✅ missing `src/reporting.ts` failed module resolution | ✅ 5/5 focused tests passed | ✅ multi-page scopes/cursor mismatch, active/degraded diagnostics, typed/filterable assets, two-account isolation, empty/partial/unsupported Insights, contract-valid handlers | ✅ fixed minor-unit campaign budgets, full cursor request binding, and canonical `assets` response while focused tests/typecheck stayed green |
| 3.2 Hybrid progress persistence | `test/apply-progress.test.ts` | Structural integration | ✅ task 3.1 cumulative evidence passed | ✅ 7/16 state was absent | ✅ cumulative progress includes task 3.2 | ✅ prior Unit 1/2 and task 3.1 sections remain asserted | ➖ Artifact materialization only |
| 3.3 Exact account-timezone pacing | `test/pacing.test.ts` | Pure unit + Fastify integration | ✅ tasks 3.1–3.2 focused checks and typecheck green | ✅ missing `src/pacing.ts` failed module resolution | ✅ 6/6 focused tests passed | ✅ DST-short month, exact month start, missing timezone, missing spend, overspend, JPY/KWD/unknown currency, and scoped handler | ✅ locally imported Temporal/Decimal, pinned exact dependencies, and runtime-accurate result types remained green under typecheck |
| 3.3 Hybrid progress persistence | `test/apply-progress.test.ts` | Structural integration | ✅ task 3.2 cumulative evidence passed | ✅ 8/16 state was absent | ✅ cumulative progress includes task 3.3 | ✅ all prior Unit 1–3.2 sections remain asserted | ➖ Artifact materialization only |

## Unit 3 Review Remediation — Strict TDD Cycle Evidence

| Remediation | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| Production Unit 3 composition and lifecycle | `test/runtime.test.ts` | Integration with temp SQLite/fake fetch/fake secrets | ✅ baseline `npm test`: 65/65 | ✅ production server exposed only placeholder handlers | ✅ every Unit 3 handler, JIT scoped credentials, audited Meta request, defaults, and DB close paths passed | ✅ startup failure, clean close, absent credentials, environment parsing, and symlinked root | ✅ one runtime composition root; removed unsafe pre-validation `chmod` |
| End-to-end Meta timeout | `test/meta-client.test.ts` | Unit with fake fetch/streams | ✅ 65/65 | ✅ never-ending body and late headers could outlive the timeout | ✅ fetch/header acquisition and body consumption now share one active timeout | ✅ fetch ignoring abort, late headers, hanging body, malformed body, and body cancellation | ✅ one abort race and one bounded body reader |
| Meta envelope retry classification | `test/meta-client.test.ts` | Unit with fake fetch | ✅ 65/65 | ✅ transient Meta HTTP 400 envelopes were never retried | ✅ safe GET retries honor `error.is_transient`; POST remains single-attempt | ✅ transient/nontransient GET 400 and transient POST 400 | ✅ normalized error carries one transient flag |
| Capability edge pagination and bounds | `test/reporting.test.ts` | Unit with fake Meta client | ✅ 65/65 | ✅ discovery fetched only first pages of dependent assets | ✅ Pages, pixels, datasets, lead forms, and Instagram accounts use bounded pagination | ✅ next pages, repeated cursors, and page limits | ✅ reused audited `MetaClient.paginate` |
| Authoritative capability prerequisites | `test/reporting.test.ts` | Unit + integration | ✅ 65/65 | ✅ permission and Ad Account task denials could still report usable capabilities | ✅ capabilities derive permission, `ADVERTISE`, Page, tracking, form, and Instagram requirements | ✅ allowed, denied, partial, and missing dependency states | ✅ one prerequisite/gap model feeds all capability statuses |
| Capability-specific error preservation | `test/reporting.test.ts`, `test/app.test.ts` | Unit + Fastify integration | ✅ 65/65 | ✅ capability failures collapsed into generic errors or implied a resolved scope | ✅ 400/401/403/409 retain actionable codes and raw supplied scope without `resolved_scope` | ✅ malformed scope, auth, authority, mapping, and cursor failures | ✅ centralized capability problem mapping |
| Contract-valid Meta throttling | `test/reporting.test.ts`, `test/generation.test.ts` | Integration + generated contract | ✅ 65/65 | ✅ numeric `Retry-After` failed the declared response contract | ✅ Meta 429 emits a canonical integer string and OpenAPI/generated types agree | ✅ present, absent, and normalized retry values | ✅ one string contract boundary |
| Request-ID correlation | `test/reporting.test.ts`, `test/pacing.test.ts` | Integration | ✅ 65/65 | ✅ handlers generated different IDs for headers, bodies, errors, and Meta audits | ✅ each handler creates one ID and propagates it through all layers | ✅ success, validation failure, Meta failure, reporting, and pacing | ✅ one request-scoped ID per handler invocation |
| Canonical pacing decimals | `test/pacing.test.ts` | Pure unit + integration | ✅ 65/65 | ✅ Decimal accepted non-contract hexadecimal and exponent forms | ✅ canonical decimal grammar is validated before exact arithmetic | ✅ hex, binary, plus, exponent, whitespace, leading zero, `.5`, `1.`, valid fractions, and overspend | ✅ one anchored grammar at the trust boundary |
| Pacing discriminator/type agreement | `test/pacing.test.ts`, `test/generation.test.ts` | Integration + generated contract | ✅ 65/65 | ✅ generated variants did not match runtime `available`/`unavailable` values | ✅ explicit OpenAPI discriminator mappings generate runtime-compatible variants | ✅ both result branches compile and validate | ✅ no duplicate runtime adapter types |
| Hybrid remediation persistence | `test/apply-progress.test.ts` | Structural integration | ✅ prior Unit 1–3 evidence passed | ✅ remediation evidence section was absent | ✅ cumulative progress includes this review cycle | ✅ prior evidence and unchanged 8/16 state remain asserted | ➖ Artifact materialization only |

## Unit 4 — Strict TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 4.1 Secure chat media staging | `test/media.test.ts`, `test/db.test.ts`, `test/runtime.test.ts` | Filesystem/SQLite + Fastify integration | ✅ baseline `npm test`: 80/80 | ✅ missing `src/media.ts`, migration-v2 media table, and production route; placeholder returned 422 | ✅ 8 focused media tests plus DB/runtime checks pass | ✅ JPEG/PNG/MP4, MIME spoof, empty/truncated/polyglot, total timeout/abort, oversize, duplicate/extra parts, path metadata, scope mismatch, hash/modes, symlink root/parent, expiry and residue cleanup | ✅ one streaming service owns validation/publication/cleanup; one handler owns exact multipart shape |
| 4.2 Immutable typed proposals | `test/operations.test.ts`, `test/db.test.ts`, `test/runtime.test.ts` | SQLite/domain + Fastify integration | ✅ 4.1 focused checks green | ✅ missing `src/operations.ts`, operation/idempotency/link tables, and production handlers | ✅ 5 focused operation tests plus DB/runtime checks pass | ✅ canonical key order, same/conflicting key, concurrent/restart reuse, all three campaign kinds, Page/pixel/form/media checks, update/delivery/budget, Creative prohibition, expiry/cross-scope/hash/target failures, AJV rejection and GET | ✅ one canonical serializer/hash, permanent DB binding, shared scope/capability/target validation; no Meta write path |
| 4.3 Owner approval/rejection | `test/approval.test.ts`, `test/db.test.ts`, `test/runtime.test.ts` | Security/SQLite + Fastify integration | ✅ 4.1–4.2 focused checks green | ✅ missing `src/approval.ts`, proof/decision/audit-link tables, proof documentation, and production handlers | ✅ 9 focused approval tests plus DB/runtime checks pass | ✅ owner/channel/secret/signature/method/path/body/canonical encoding, stale/future, nonce replay across concurrency/restart, approve/reject/idempotent/opposite decisions, exact 12h equality, authority/media/payload staleness, rollback, canary/linkage and contract 202/200 | ✅ one documented HMAC protocol, immutable nonce/decision records, conditional state transitions, pre-decision revalidation, and terminal media cleanup |
| Unit 4 hybrid progress persistence | `test/apply-progress.test.ts` | Structural integration | ✅ all prior cumulative evidence retained | ✅ Unit 4 evidence and 11/16 state were absent | ✅ cumulative filesystem/Engram progress records Unit 4 | ✅ prior Unit 1–3 sections and Unit 5+ unchecked state remain asserted | ➖ Artifact materialization only |

## Unit 4 Confirmed Review Remediation — Strict TDD Cycle Evidence

| Finding | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 1 scope before durable media writes | `test/media.test.ts` | Security/filesystem | ✅ 39/39 focused baseline | ✅ unauthorized iterable was consumed before scope rejection | ✅ scope resolves before file creation | ✅ direct and file-first multipart rejection leave no new file/row | ✅ one service scope gate |
| 2 deterministic container structure | `test/media.test.ts` | Security unit/integration | ✅ baseline | ✅ malformed JPEG, corrupt PNG CRC, and MP4 without `moov` were accepted | ✅ JPEG frame/scan, PNG chunk CRC/order, and MP4 box requirements enforced | ✅ all three valid formats plus truncation/polyglot cases | ✅ minimal dependency-free parsers around `file-type` |
| 3 media-root swap/TOCTOU | `test/media.test.ts` | Filesystem security | ✅ baseline | ✅ post-init symlink swap published outside root | ✅ inode/device/realpath/owner/mode checks, `O_NOFOLLOW`, atomic publication, and guarded cleanup/hash | ✅ publication and expiry cleanup swaps leave outside target untouched | ✅ shared guarded media operations |
| 4 upload I/O cancellation | `test/media.test.ts` | Stream integration | ✅ baseline | ✅ timeout rejected while underlying stream remained alive | ✅ stream is destroyed and iterator return requested | ✅ abort and timeout prevent delayed publication/residue | ✅ one deadline helper and cancellation path |
| 5 media request correlation | `test/media.test.ts`, `src/request-id.ts` | Fastify/audit integration | ✅ baseline | ✅ generated audit and problem IDs diverged | ✅ one normalized ID reaches service, audit, header, and body | ✅ supplied and generated IDs | ✅ centralized request-ID normalization |
| 6 Unicode filename controls | `test/media.test.ts` | Security unit/integration | ✅ baseline | ✅ U+202E filename staged | ✅ Unicode `Cc`/`Cf` metadata rejected | ✅ ASCII paths/controls and bidi/format controls | ✅ one metadata predicate |
| 7 media DB invariants | `test/media.test.ts`, `test/db.test.ts` | SQLite integration | ✅ baseline | ✅ non-positive generation and 11:59:59.999 expiry inserted | ✅ positive referenced generation and canonical exact +12h enforced | ✅ fresh schema, v2→v3 upgrade, fingerprint/backup | ✅ migration 3 upgrades existing v2 installs |
| 8 usable lead forms | `test/operations.test.ts` | Domain integration | ✅ baseline | ✅ false/absent publication/usability accepted | ✅ instant-form proposal requires explicit published and usable state | ✅ unpublished, unusable, absent state, wrong Page, and valid form | ✅ check remains at campaign semantic boundary |
| 9 absolute schedule ordering | `test/operations.test.ts` | Domain unit/integration | ✅ baseline | ✅ valid DST-offset interval was rejected lexically | ✅ parsed instants compare absolute time | ✅ valid cross-offset, equal instant, malformed, and reversed cases | ✅ one schedule predicate reused by create/update |
| 10 deterministic JSON canonicalization | `test/operations.test.ts` | Pure unit | ✅ baseline | ✅ `localeCompare` reordered Unicode keys by host locale; object reconstruction reordered integer-like keys | ✅ direct serializer uses explicit UTF-16 code-unit ordering with native JSON number/string encoding | ✅ astral/BMP/decomposed/nested/integer-like keys, escapes, decimals, negative zero, and non-finite rejection | ✅ no dependency added |
| 11 operation DB bindings/state/expiry | `test/operations.test.ts`, `test/db.test.ts` | SQLite integration | ✅ baseline | ✅ mismatched idempotency identity, result/status, non-12h rows, and corrupt legacy rows were accepted | ✅ identity trigger/index, result/expiry constraints, and fail-closed legacy validation added | ✅ direct SQL negatives, clean/corrupt v2 upgrade, backup/fingerprint, concurrency retained | ✅ one remediation migration |
| 12 expiry crossed during revalidation | `test/approval.test.ts` | Clock/SQLite integration | ✅ baseline | ✅ approval committed after async revalidation crossed equality | ✅ injected clock rechecked inside final decision transaction | ✅ initial equality and crossing-revalidation paths | ✅ final commit owns expiry decision |
| 13 approval request correlation | `test/approval.test.ts`, `src/request-id.ts` | Fastify/audit integration | ✅ baseline | ✅ generated audit and failure response IDs diverged | ✅ handler passes one normalized ID to every layer | ✅ supplied success and generated failure IDs | ✅ shared request-ID helper |
| 14 crash-reconciled media cleanup | `test/approval.test.ts` | Filesystem/SQLite restart | ✅ baseline | ✅ committed rejection plus failed delete survived restart indefinitely | ✅ terminal DB state commits before deletion; startup removes terminal/orphan files | ✅ successful delete, simulated failure, retry/restart | ✅ idempotent reconciliation in media startup |
| 15 bounded nonce/audit abuse | `test/approval.test.ts` | Security/SQLite integration | ✅ baseline | ✅ repeated attempts persisted without limit | ✅ configurable production caps bound accepted nonces per operation and failed decision audits globally | ✅ proof and malformed-attempt caps | ✅ immutable decision/audit history retained |
| Remediation progress persistence | `test/apply-progress.test.ts` | Structural integration | ✅ cumulative history present | ✅ remediation section and 116-test result absent | ✅ filesystem and Engram merged | ✅ prior sections and 11/16 state retained | ➖ artifact only |

## Unit 4 Approval Review Remediation — Strict TDD Cycle Evidence

| Warning | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| W1 authority/generation race | `test/approval.test.ts`, `test/operations.test.ts` | Async/SQLite security integration | ✅ 35/35 focused baseline | ✅ generation rotation during target validation and after async revalidation still committed generation-1 approval | ✅ post-async and transaction-entry authoritative generation checks reject stale operations without a decision | ✅ both async race windows, correlated audit, stale state, and zero decisions | ✅ reused authoritative scope resolver; Unit 5 execution revalidation remains required |
| W2 proof expiry during secret lookup | `test/approval.test.ts` | Clock/secret/SQLite integration | ✅ 35/35 focused baseline | ✅ proof crossing from exact 300-second equality to 301 seconds during secret lookup was accepted and consumed | ✅ freshness is rechecked after secret lookup and at transaction entry using one consumed-at instant | ✅ initial stale/future cases plus exact-boundary crossing; no nonce or decision persisted | ✅ one shared freshness predicate |
| W3 durable bounded ingress and nonce retention | `test/approval.test.ts`, `test/db.test.ts` | Security/SQLite/OpenAPI integration | ✅ 35/35 focused baseline | ✅ failed audit was silently dropped, no global limiter existed, and nonce deletion was universally prohibited | ✅ migration v4 adds two-row durable global/owner counters, 429/Retry-After, and controlled unreferenced nonce purge; admitted attempts always audit | ✅ approve/reject 429 contract, fixed two-row schema, restart-safe v3 evidence migration, pre/post-horizon deletion, and referenced nonce preservation | ✅ permanent append-only audits retained; bounded ingress replaces audit dropping and no archive subsystem was added |
| Approval remediation progress | `test/apply-progress.test.ts` | Structural integration | ✅ cumulative history present | ✅ approval-remediation section and 120-test result absent | ✅ filesystem and Engram merged | ✅ prior sections and 11/16 state retained | ➖ artifact only |

## Unit 4 Approval Body-Binding Remediation — Strict TDD Cycle Evidence

| Warning | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| Approval no-body framing and proof binding | `test/approval.test.ts` | Raw HTTP/Fastify/SQLite security integration | ✅ 15/15 focused baseline | ✅ chunked multipart bytes with an empty-body signature committed approval/rejection and only failed during response normalization | ✅ any Transfer-Encoding, non-canonical/nonzero Content-Length, or parsed body fails with contract-valid correlated 400 before decision processing | ✅ raw chunked approve/reject, transfer encoding, nonzero/malformed/duplicate length, parsed body, and truly empty approve/reject controls | ✅ one shared handler guard; no parser, body normalization, dependency, or migration added |
| Body-binding remediation progress | `test/apply-progress.test.ts` | Structural integration | ✅ cumulative history present | ✅ body-binding section and 122-test result absent | ✅ filesystem and Engram merged | ✅ all prior sections and 11/16 state retained | ➖ artifact only |

## Unit 4 PNG Structure Remediation — Strict TDD Cycle Evidence

| Warning | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| PNG critical-chunk structure | `test/media.test.ts` | Filesystem/media security integration | ✅ 13/13 focused baseline | ✅ exact valid-CRC `IHDR`, `IDAT`, duplicate `IHDR`, `IEND` input staged successfully; ordering table also accepted invalid structures | ✅ minimal state machine enforces one first 13-byte `IHDR`, applicable pre-data `PLTE`, contiguous `IDAT`, one terminal zero-byte `IEND`, CRCs, legal chunk names, and rejects unknown critical chunks | ✅ valid indexed palette plus multiple contiguous `IDAT` and trailing ancillary data; late/duplicate `PLTE`, interrupted `IDAT`, unknown critical, and duplicate `IEND` | ✅ one dependency-free `validPng` predicate; no decoder, schema, migration, or Unit 5 code |
| PNG remediation progress | `test/apply-progress.test.ts` | Structural integration | ✅ cumulative history present | ✅ PNG section and 124-test result absent | ✅ filesystem and Engram merged | ✅ all prior sections and 11/16 state retained | ➖ artifact only |

## Unit 5 — Strict TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 5.1 Approved execution and paused bundles | `test/execution.test.ts`, `test/db.test.ts`, `test/approval.test.ts`, `test/media.test.ts`, `test/meta-client.test.ts`, `test/runtime.test.ts` | SQLite/domain + fake-Meta + Fastify integration | ✅ 69/69 focused Unit 1–4 baseline | ✅ migration remained v4, execution service/read-bound media/multipart transport were absent, and approval returned pending 202 without execution | ✅ focused execution, DB, approval, media, Meta, and runtime checks pass | ✅ sales image and instant-form video bundles, Campaign→Ad Set→Creative→Ad order, PAUSED-only delivery status, update/delivery/monthly-budget paths, one-worker concurrency, exact expiry, stale authority, media race, and intent-first DB guards | ✅ reused existing operation/revalidation/Meta/media/runtime boundaries; no endpoint or dependency added |
| 5.2 Partial recovery and ambiguous-write pause | `test/execution.test.ts`, `test/runtime.test.ts` | SQLite restart + fake-Meta integration | ✅ task 5.1 focused checks green | ✅ restarted safe partial and committed local steps remained executing; `reconcile` was absent; ambiguous recovery had no callable path | ✅ known successful steps resume at startup and ambiguous writes remain paused without redispatch | ✅ image/campaign partial bundle, local-budget post-commit crash, network ambiguity, orphaned intent, terminal replay, and production startup recovery | ✅ one persisted step state machine; no name-based guessing, destructive compensation, queue, worker service, or new HTTP route |
| Unit 5 hybrid progress persistence | `test/apply-progress.test.ts` | Structural integration | ✅ all prior cumulative evidence retained | ✅ Unit 5 evidence and 13/16 state were absent | ✅ cumulative filesystem/Engram progress records Unit 5 | ✅ prior Unit 1–4 sections remain asserted while Unit 6 stays unchecked | ➖ artifact only |

## Unit 5 Execution-History Remediation — Strict TDD Cycle Evidence

| Finding | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| Successful steps require durable external evidence and terminal executions are immutable | `test/execution.test.ts` | SQLite security/invariant integration | ✅ 27/27 focused execution and migration checks | ✅ SQLite accepted `succeeded` without `external_id` and allowed a completed execution timestamp to be rewritten | ✅ migration-v5 CHECK requires a successful step external ID and the transition trigger permits changes only from `running` | ✅ direct invalid-success and post-terminal mutation probes plus all execution/restart scenarios pass | ✅ schema constraints fix both write paths without service branches or new state |
| Remediation progress persistence | `test/apply-progress.test.ts` | Structural integration | ✅ cumulative Unit 1–5 history present | ✅ remediation section absent | ✅ filesystem progress records the fresh review cycle | ✅ 142-test and 13/16 assertions retained | ➖ artifact only |

## Unit 5 Confirmed Review Remediation — Strict TDD Cycle Evidence

| Finding | Test File | Layer | Result |
|---|---|---|---|
| 1 POST proof transport and credential confinement | `test/meta-client.test.ts`, `test/execution-wire.test.ts` | Native fetch/multipart security | POST proof is a form field; tokens/proofs are absent from URLs and audit evidence. |
| 2 Typed lifecycle results and explicit next action | `test/execution.test.ts`, `test/approval.test.ts` | Domain + HTTP contract | Pending, active, reconciliation, stale, failed, and succeeded views expose contract-valid actions and evidence. |
| 3 Lifetime budget end time | `test/operations.test.ts` | OpenAPI + domain | Lifetime campaign budgets require an exact Ad Set end time before persistence. |
| 4 One creative media item | `test/operations.test.ts` | OpenAPI + domain | Campaign execution accepts exactly one bound media item. |
| 5 Allowlisted review projection | `test/operations.test.ts`, `test/approval.test.ts` | Data exposure boundary | Responses expose `review` plus `payload_hash`, never unrestricted stored payloads. |
| 6 Active versus reconciliation-required execution | `test/execution.test.ts` | Domain + contract | Executing responses distinguish safe waiting from mandatory manual reconciliation. |
| 7 Transactional execution audit evidence | `test/execution.test.ts`, `test/db.test.ts` | SQLite invariants | Claim, step intent/outcome, result, and reconciliation audits are linked from the state-changing transaction. |
| 8 Original request correlation | `test/execution.test.ts`, `test/execution-crash-matrix.test.ts`, `test/runtime.test.ts` | Runtime/restart | Execution, resumed steps, Meta calls, and audits retain the original execution request ID. |
| 9 Persisted access after generation rotation | `test/operations.test.ts`, `test/approval.test.ts` | Authorization/lifecycle | Stored operation views retain persisted labels and require owned scope without requiring the bound generation to remain active. |
| 10 Terminal media cleanup ordering | `test/execution.test.ts`, `test/approval.test.ts` | SQLite/filesystem restart | Terminal state commits before cleanup and startup reconciliation removes residue after deletion failure. |
| 11 Complete bundle success invariant | `test/execution.test.ts`, `test/db.test.ts` | SQLite migration | Migration v6 rejects forged/incomplete campaign success and fails closed when legacy rows violate it. |
| 12 Typed terminal results | `test/execution.test.ts`, `test/db.test.ts` | SQLite + contract | Terminal result JSON must match its operation/status shape and contain immutable resource evidence. |
| 13 Immutable terminal result | `test/execution.test.ts` | SQLite | Terminal operation result JSON cannot be rewritten after completion. |
| 14 Five-by-five crash matrix | `test/execution-crash-matrix.test.ts` | File-backed restart | Every step is tested before intent, after intent, on timeout, after response, and after persistence without ambiguous replay. |
| 15 Real MetaClient campaign canaries | `test/execution-wire.test.ts` | Real client/fake fetch | All three campaign kinds prove v26 native multipart success and definitive error normalization without replay. |

Unit 5 acceptance is complete after the fresh SQLite/reconciliation gate reported zero CRITICAL/WARNING findings and the final dependency audit passed. Unit 6 remains absent.

## Unit 5 SQLite/Reconciliation Remediation — Strict TDD Cycle Evidence

| Finding | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 1 skipped/out-of-order steps | `test/execution.test.ts` | Direct SQLite integration | ✅ 32/32 focused baseline | ✅ sequence-4 Ad and later intents inserted without successful predecessors | ✅ v6/v7 predecessor triggers reject missing, failed, skipped, duplicate, wrong-key/kind/sequence paths | ✅ bundle prefixes plus all three singleton operation types; runtime five-step control passes | ✅ one DB predicate per intent/transition; no service branch |
| 2 NULL-safe typed results | `test/execution.test.ts` | Direct SQLite integration | ✅ baseline | ✅ missing discriminators escaped nullable `NOT (...)` and terminalized operations | ✅ CASE-based validator converts every missing/type mismatch to explicit failure | ✅ every top-level/nested campaign field, failure fields/resource items, forged extras, mismatched shape, and valid controls | ✅ one shared SQL expression serves migration preflight and triggers |
| 3 v5→v6 evidence preservation | `test/db.test.ts` | Migration integration | ✅ baseline | ✅ result bytes were reserialized and step correlation was replaced | ✅ v6 copies exact correlation and never updates terminal result JSON | ✅ exact whitespace/order bytes, differing execution/step IDs, immutable post-upgrade controls, and v7 no-rewrite path | ✅ deleted normalization and fabricated claim backfill |
| 4 unaudited legacy outcomes | `test/db.test.ts` | Migration security integration | ✅ baseline | ✅ terminal v5 history with zero linked step audits upgraded | ✅ v6/v7 require immutable linked started/outcome evidence and roll back otherwise | ✅ audited success, unaudited rollback, and corrupted-v6 rollback with version/evidence preservation | ✅ fail closed; no migration-created runtime claims |
| 5 crash-matrix assertion strength | `test/execution-crash-matrix.test.ts` | File-backed restart integration | ✅ 25 combinations passed | ✅ prior last-call check would miss replay of an earlier successful path and omitted partial evidence/compensation assertions | ✅ every case asserts exact prefix, unresolved step, action, no redispatch/read/compensation, and persisted correlation | ✅ all five steps × five crash points with observed two- and four-resource prefixes | ➖ test-only hardening; runtime already satisfied the stronger contract |

### Current Unit 5 Remediation Verification

- `npm test`: 161 tests, 0 failures for the prior migration-v7 cycle.
- Task state: 13/16 tasks complete; Unit 6 remains unchecked.

## Unit 5 Migration-v8 Incident Remediation — Strict TDD Cycle Evidence

| Finding | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| A exact media and step-audit identity | `test/execution.test.ts`, `test/db.test.ts` | Direct SQLite + migration integration | ✅ incident baseline DB 21/21 | ✅ `media:` and a NULL `meta_call.step_key` were accepted | ✅ exact linked media and constrained audit-link probes pass | ✅ NULL/empty/malformed/wrong-case/missing/cross-operation/cross-scope/wrong-kind cases plus valid scoped media | ✅ v8 rebuilds only the audit-link table; existing step columns remain `NOT NULL` |
| B exact persisted resource projection | `test/execution.test.ts`, `test/db.test.ts` | Direct SQLite + migration integration | ✅ prior typed-shape probes green | ✅ forged successful IDs and forged failed resources terminalized | ✅ successful objects and ordered failed resources must equal same-operation successful steps | ✅ forged/swapped/duplicate/missing/extra/foreign/reordered resources plus valid projections; runtime maps object and budget types | ✅ one NULL-safe validator serves runtime triggers and migration preflight |
| C terminal execution coupling and v8 rollback | `test/execution.test.ts`, `test/db.test.ts` | Direct SQLite + migration integration | ✅ prior coupling regression retained | ✅ interrupted-cycle probe accepted failed terminal state without an execution | ✅ succeeded/failed runtime and v5 migration paths require exactly one compatible execution | ✅ clean v5/v6/v7→v8 and corrupt nullable-link/forged-result rollback preserve exact bytes, correlations, and audit counts | ✅ distinct v8 rebuild recreates existing audit triggers and fabricates no evidence |
| Migration-v8 progress persistence | `test/apply-progress.test.ts` | Structural integration | ✅ cumulative history retained | ✅ migration-v8 section and 169-test result were absent | ✅ cumulative filesystem and Engram progress updated | ✅ all prior sections and unchanged 13/16 state retained | ➖ artifact only |

### Migration-v8 Verification

- `npm test`: 169 tests, 0 failures.
- Focused: `test/execution.test.ts` 23/23; `test/db.test.ts` 23/23; crash/wire 3/3.
- `npm run typecheck`, `npm run build`, `npm run generate:check`, and `git diff --check`: passed.
- `npm audit`: completed with one high `fast-uri` advisory group and one moderate `qs` advisory group; dependency updates were kept outside this DB-only remediation.
- Task state: 13/16 tasks complete; Unit 6 remains unchecked and absent.

## Unit 5 Dependency-Security Remediation — Strict TDD Cycle Evidence

| Finding | Evidence | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| Vulnerable transitive URI/query parsers | `package-lock.json`, `npm ls fast-uri qs`, `npm audit` | Dependency supply chain | ✅ `npm test`: 169/169 | ✅ `fast-uri` 3.1.5/4.1.2 and `qs` 6.15.3 were installed; audit reported high and moderate advisory groups | ✅ targeted update resolved `fast-uri` to 3.1.7/4.1.4 and `qs` to 6.16.0; audit reports 0 vulnerabilities | ✅ chains remain `ajv` → `fast-uri@3.1.7`, Fastify compilers → `fast-uri@4.1.4`, and `openapi-backend` → `qs@6.16.0` | ✅ lockfile-only resolution change; no direct dependency, override, or parent bump |

### Dependency-Security Verification

- `package.json`: unchanged.
- `package-lock.json`: only the three intended transitive versions, tarball URLs, integrity hashes, and final newline changed.
- `npm audit`: 0 vulnerabilities.
- Task state: 13/16 tasks complete; Unit 5 acceptance is complete and Unit 6 remains unchecked and absent.

## Unit 6 — Strict TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 6.1 OpenClaw plugin | `test/openclaw-plugin.test.ts`, package `check` | Host adapter/security + package | ✅ Unit 5: 169/169 and zero audit findings | ✅ plugin package/imports were absent | ✅ 7/7 focused tests and package build/dry-pack pass | ✅ exact nine tools/two commands, unauthorized owner, exact proof, loopback/redirect, path/symlink, upload, timeout/error secrecy | ✅ host peer dependency remains outside root runtime; native fetch/crypto/fs reused |
| 6.2 launchd and local operations | `test/launchagent.test.ts`, `test/runtime.test.ts`, `test/database-operations.test.ts` | macOS plist/process/SQLite integration | ✅ plugin slice green | ✅ installer, shutdown, Keychain production loader, and DB command module were absent | ✅ 5 launchd, 7 runtime, and one DB operations probe pass | ✅ native plist lint, idempotent temp install/uninstall, failed bootstrap rollback, both signals, Keychain load, verified backup and restartable restore | ✅ one dependency-free installer and thin wrappers over existing protected backup/restore |
| 6.3 phased migration validation | `test/migration-validation.test.ts`, existing reporting/execution/DB suites | Deterministic workflow/filesystem integration | ✅ 6.1–6.2 focused checks green | ✅ validator import failed before implementation | ✅ 4 focused migration tests pass | ✅ fixtures cover exact 14 apps/five-app client/two-account pilot, duplicate/wrong IDs/order/ownership, missing authority, parity tolerance, failed/safe canary, restart, redaction, rollback before/after day seven, observation and retirement gates | ✅ JSON manifest plus append-only JSONL evidence; no control plane, Meta call, routing mutation, or dependency added |
| Unit 6 hybrid progress persistence | `test/apply-progress.test.ts` | Structural integration | ✅ 187/187 before progress update | ✅ Unit 6 evidence and 16/16 state were absent | ✅ cumulative artifact reports all tasks | ✅ all prior Unit 1–5 sections retained | ➖ artifact only |

## Unit 6 Acceptance Remediation — Strict TDD Cycle Evidence

| Finding group | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| Attachment identity, gateway deadline/correlation, clean package | `test/openclaw-plugin.test.ts` | Plugin security + package integration | ✅ prior 7 plugin tests | ✅ shared missing-identity buckets, response-body timeout gap, upstream error reflection, and absent package proof reproduced | ✅ focused plugin suite passes | ✅ absent/cross sender/conversation, stalled/oversize streams, mismatched IDs, fixed errors, six-file tarball/import | ✅ one complete context key and one bounded correlated response reader; no dependency added |
| Transactional LaunchAgent and safe operations docs | `test/launchagent.test.ts` | Native plist/process + structural docs | ✅ prior 5 launchd tests | ✅ loaded state was not restored, KeepAlive looped failures, logs/Umask and safe docs were absent | ✅ focused launchd/docs suite passes | ✅ active/fresh bootstrap and kickstart failures, private files, native lint, no tunnel/bearer argv docs | ✅ existing installer owns rollback; no real launchctl or home mutation |
| Linked migration evidence and integrity | `test/migration-validation.test.ts` | Pure workflow + private filesystem integration | ✅ accepted Unit 1–5 suite retained | ✅ arbitrary events, secret values, self-asserted gates, weak ownership/authority/parity, no freeze, and unhashed evidence reproduced | ✅ focused migration suite passes | ✅ fixtures cover manifest ownership, exact schemas, full authority/parity, linked PAUSED canary, signoff/freeze/cutover/rollback/retire gates, modes/symlink/edit/reorder/truncation | ✅ one deterministic recorder and machine-readable gate evaluator; no control plane or database |
| Acceptance-state coherence | `test/apply-progress.test.ts` | Structural integration | ✅ cumulative Unit 1–5 evidence | ✅ provisional 16/16 contradicted fresh review | ✅ tasks remain unchecked and progress reports 13/16 during remediation | ✅ final 16/16 transition is deferred until every check passes | ➖ artifact state only |

The acceptance checkpoint remained at 13/16 until the complete software verification matrix passed. After that gate, tasks 6.1–6.3 were checked. This records implementation acceptance only: the real pilot, cutover, seven-day observation, rollback exercise, and retirement remain operator work.

### Unit 6 Acceptance Verification

- Focused Unit 6: 26 tests, 0 failures (`openclaw-plugin`, `launchagent`, database operations, migration validation, progress coherence).
- Full `npm test`: 195 tests, 0 failures; all accepted Unit 1–5 tests remain green.
- Plugin `npm run check`: TypeScript build and six-file dry pack passed; the built entrypoint imports against `openclaw@2026.9.2`.
- `npm run typecheck`, `npm run build`, and `npm run generate:check`: passed.
- `npm audit --audit-level=low`: 0 vulnerabilities.
- `git diff --check`: passed.
- Native `/usr/bin/plutil` lint passed in a temporary directory; launchctl behavior used injected fakes only.
- No real home, launchctl session, Keychain, Meta, OpenClaw network, or `.codegraph/` mutation occurred.
- Task state: 16/16 tasks complete; SDD verify remains the next phase and archive was not run.

## Failed Verification Critical Remediation — Strict TDD Cycle Evidence

| Finding / scenario | Test File | Layer | Safety Net | RED / approval capture | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| CRITICAL 1 canonical trusted multipart metadata | `test/openclaw-runtime-integration.test.ts`, `test/openclaw-plugin.test.ts` | Plugin → native fetch adapter → Fastify → media/SQLite integration | ✅ 48/48 affected plugin/reporting/pacing/operations/runtime baseline | ✅ real `/v1/media` returned gateway failure because `source` and `attachment_id` were absent | ✅ actual Fastify validation stages canonical media | ✅ wrong sender, wrong conversation, empty message identity, valid opaque identity, response/path checks | ✅ one trusted capture fact feeds the existing multipart boundary; service schema unchanged |
| 1 decimal-safe independent budgets | `test/openclaw-runtime-integration.test.ts` | Plugin + reporting/pacing + Fastify integration | ✅ baseline | ✅ global composition invocation failed before scoped requests | ✅ USD/JPY/EUR rows preserve independent exact values | ✅ half-even USD/JPY plus timezone-unavailable EUR | ✅ reused existing `/v1/scopes` and `/v1/budget-pacing` only |
| 2 model-tool output preservation | `test/openclaw-runtime-integration.test.ts` | Plugin + reporting + Fastify integration | ✅ baseline | ✅ failed tool collapsed scope/remediation/correlation into a generic exception | ✅ success and failure preserve safe required fields | ✅ capability gaps and unauthorized scope; arbitrary local detail excluded | ✅ one local allowlisted failure projection wraps all model tools |
| 3 authorized plugin read | `test/openclaw-runtime-integration.test.ts` | Plugin + reporting + Fastify/SQLite integration | ✅ baseline | ✅ verifier found no runtime coverage; approval capture passed before related refactor | ✅ scoped campaign read creates no operation, decision, or execution | ✅ exact Meta path and exact scope asserted | ➖ existing behavior required no production change |
| 4 proposal authority separation | `test/openclaw-runtime-integration.test.ts` | Plugin + operations + Fastify/SQLite integration | ✅ baseline | ✅ verifier found no runtime coverage; approval capture passed before related refactor | ✅ explicit scope creates one pending operation only | ✅ no decision, execution, budget mutation, owner bypass, capabilities, target, or Meta call | ➖ existing behavior required no production change |
| 5 independent global composition | `test/openclaw-runtime-integration.test.ts` | Plugin + cursor-paged reporting + pacing + Fastify integration | ✅ baseline | ✅ global composition invocation failed before paging scopes | ✅ every authorized pair produces one independently correlated pacing row | ✅ page size 1 forces three pages and unavailable values remain typed | ✅ no endpoint, global state, aggregate, ranking, or dependency added |

### Critical Remediation Checkpoint

- RED execution: 6 integration tests produced 4 failures and 2 passing approval captures; failures exactly covered multipart metadata, global composition, and model-tool failure preservation.
- Focused GREEN: 16/16 plugin and plugin-runtime integration tests pass.
- Preliminary full `npm test`: 201 tests, 0 failures while task 6.1 remained reopened.
- Focused affected suite: 54 tests, 0 failures; focused plugin/plugin-runtime suite: 16 tests, 0 failures.
- Plugin `npm run check`: TypeScript build and six-file dry pack passed against OpenClaw `2026.9.2`.
- `npm run typecheck`, `npm run build`, `npm run generate:check`, `npm audit --audit-level=low`, and `git diff --check`: passed; audit reported 0 vulnerabilities.
- Final full `npm test`: 201 tests, 0 failures after the progress/task state transition.
- Task state: 16/16 tasks complete; independent SDD reverify is next and the failed verify report remains unchanged.

### Unit 6 Verification

- `npm test`: 187 tests, 0 failures before the progress-only assertion update.
- `packages/openclaw-plugin npm run check`: TypeScript build and dry pack passed with six intended package files.
- Native `/usr/bin/plutil` lint and fake-`launchctl` install/update/uninstall/rollback checks passed without real service mutation.
- Migration fixtures and CLI are local-only; no real OpenClaw, Keychain, launchctl, Meta, or home-directory mutation occurred.
- `npm audit --audit-level=low`: 0 vulnerabilities.
- Task state: 16/16 tasks complete; external SDD verification and archive remain separate phases.

### Filesystem and Retention Limits

- Node/macOS exposes `O_NOFOLLOW`, inode/device/realpath checks, and atomic rename, but not a JavaScript `openat(2)` directory-FD API. Checks therefore fail closed around each operation and prevent observed swaps; an attacker with same-user filesystem mutation rights can still race between a final path check and pathname syscall.
- Approval ingress uses one durable global row and one configured-owner row. At most 120 attempts per minute are admitted globally and 60 per minute for the owner; excess attempts are rejected before proof processing with contract-valid `429`, `Retry-After`, and current-window durable rejected counters. The table has at most two rows regardless of request volume or owner rotation.
- Every admitted approval attempt appends immutable audit evidence. Audit rows are retained permanently and are therefore not storage-bounded; their growth is globally rate-bounded to 120 rows/minute (7,200/hour, 172,800/day). No audit archive/rotation subsystem was added because permanent SQLite retention plus bounded ingress is the least-complex lossless model.
- Unreferenced proof nonces are purged at startup and before each decision after `issued_at + 300 seconds`; future skew is zero because future-issued proofs are forbidden. With fixed one-minute windows, the replay-cache portion is bounded to at most 720 admitted nonces: 120 × (five horizon windows + one boundary/burst window). A deterministic 1/minute test retains at most six unreferenced rows across seven windows. Nonces referenced by immutable approval decisions remain permanent evidence and are excluded from that cache bound.

## Dependency State

- Runtime: `@fastify/multipart`, `@js-temporal/polyfill`, `ajv`, `ajv-formats`, `decimal.js`, `fastify`, `file-type@22.0.2`, `openapi-backend`, `yaml`.
- Development: Node 24 typings, `openapi-typescript`, `tsx`, TypeScript.
- OpenClaw remains isolated to the installable plugin package as an exact host peer/development compatibility dependency; it is absent from root runtime dependencies.

## Contract and Architecture Decisions

- `openapi-backend` quick mode remains routing/security/request plumbing only; AJV 2020 is authoritative for OpenAPI 3.1 validation.
- Every centralized operation now declares reusable `500 InternalError` with project-required `X-Request-ID` and `application/problem+json` `Problem500`.
- Normalized internal errors are validated once against the original operation's exact 500 response before transmission.
- If that validation fails or the operation/schema is absent, a minimal `text/plain` emergency response is sent with `x-contract-validation: failed`; it is intentionally not called contract-valid.
- Response media and headers remain case-insensitive, and AppOptions overrides remain limited to operation IDs.
- The OpenClaw plugin exposes exactly nine concise TypeBox model schemas; deterministic approval/rejection commands remain outside model tools.
- SQLite file and backup artifacts use owner-only `0600` permissions; file databases use WAL while `:memory:` remains supported for tests.
- Credentials use random-IV AES-256-GCM with stable credential/generation/subject AAD; only the key reference and ciphertext envelope enter SQLite.
- Scope resolution requires one active client/account mapping, validated active generation, active credential, complete authority flags, and requested task/permission before downstream work.
- Audit rows accept only explicit metadata/evidence fields and are protected from update/delete by SQLite triggers.
- `/usr/bin/security add-generic-password -w` is invoked with `-w` last and receives secret bytes through stdin, matching the CLI's documented prompt mode; secrets never enter argv or retained subprocess errors.
- File-backed operations require an explicit trusted data root. Backups/restores reject unsafe paths and existing targets, validate integrity plus the exact supported schema/version in a protected temporary file, then atomically rename.
- Prompt, model-tool, chat, and Meta mutation canary surfaces remain deferred to their Unit 5/6 owners; Unit 4 proposal, proof, decision, media, response, SQLite, and audit canaries are executable.
- Keychain commands have a 10-second default timeout. Timeout aborts the injected runner and kills the real spawned child with `SIGKILL`; timers are cleared on every completion path.
- Backup authenticity uses a deterministic SHA-256 fingerprint derived from a fresh in-memory execution of canonical migrations through v8. The fingerprint includes normalized `sqlite_schema`, table columns, foreign keys, indexes, index columns, CHECK/UNIQUE SQL, and triggers; restore also requires clean integrity and foreign-key checks.
- Backup work occurs in a generated `0700` directory under the trusted root. The final destination and temporary SQLite file are both atomically reserved at `0600` before backup writes; sidecars remain confined by the private directory.
- Meta transport pins `v26.0`, obtains credentials just in time, signs `appsecret_proof`, retries only bounded safe GET attempts, ignores absolute pagination URLs in favor of opaque cursors, and audits every attempt/poll/page.
- Meta transport bounds response bodies to 10 MiB and keeps one timeout active across fetch/header acquisition and streamed body consumption, even for injected fetch implementations that ignore `AbortSignal`.
- Reporting cursors are HMAC-bound to caller, scope, filters, and limit; capability discovery paginates all dependent edges and derives status from authoritative permissions, Ad Account tasks, and asset prerequisites.
- Reporting and pacing handlers create one request ID per invocation and propagate it through response headers/bodies, normalized errors, service calls, Meta transport, and audit rows.
- Pacing imports the Temporal polyfill locally, rejects non-canonical decimal spellings before 50-digit Decimal round-half-even arithmetic, and uses pinned Node ICU currency precision; unknown codes fail closed.
- OpenAPI maps pacing's `available` and `unavailable` discriminator values explicitly, and `Retry-After` is a canonical nonnegative integer string in runtime and generated types.
- Migration v2 owns Unit 4 tables; migration v3 hardens their invariants; migration v4 adds approval ingress counters and controlled nonce retention; migration v5 adds execution history; repaired migration v6 preserves exact compatible v5 result/correlation/audit evidence and fails closed rather than normalizing; migration v7 adds successful-predecessor ordering and NULL-safe result validation; migration v8 fail-closes existing v7 evidence, rebuilds execution-audit links with step-key constraints, and binds exact media/result resources to immutable successful steps. Compatible operation, nonce, decision, media, result, correlation, and linked audit evidence migrates without deletion, byte rewriting, or fabricated runtime claims.
- Media accepts exactly one trusted multipart file plus three fields, validates declared and actual JPEG/PNG/MP4 content under a total deadline and 25 MiB streaming bound, enforces PNG critical-chunk uniqueness/order and contiguous image data without decoding pixels, publishes random `0600` files only below a validated private `0700` root, and never exposes storage paths.
- Proposal idempotency permanently binds actor, operation type, scope, key, and canonical payload hash. Approval/proposal revalidation uses scoped capabilities, active generation/credential authority, targets, currency, schedules, and bound file hashes; no Meta writes occur in Unit 4.
- Owner proof is HMAC-SHA256 over version, uppercase method, raw path/query, decision, operation ID, exact body hash, configured channel-scoped owner, Unix timestamp, and canonical nonce. It is fresh for 300 seconds with no future issue time; nonces and decisions are immutable and replay-safe.
- Approval and rejection are strictly bodyless. Framing/body signals are rejected before service invocation, secret lookup, rate admission, nonce consumption, authority checks, or decision writes; valid requests continue to sign SHA-256 of the truly empty body. HTTP-parser rejections such as duplicate Content-Length may occur before Fastify can attach an application request ID, while requests reaching the handler return one correlated RFC 9457 ID.
- Approval now invokes the Unit 5 executor after its immutable approved decision. Terminal execution returns contract-valid 200; active or reconciliation-required execution returns 202; rejection remains terminal without execution.
- Each Meta mutation has a persisted intent before dispatch and an immediate immutable step outcome afterward. Successful partial steps resume by exact stored external ID; unresolved intent becomes internal `reconciliation_required` while the API remains `executing` and is never retried automatically.
- Campaign bundle execution uploads one unambiguous bound image or video, then creates Campaign, Ad Set, Creative, and Ad in order. Campaign, Ad Set, and Ad are always `PAUSED`; Creative has no delivery status. Multi-asset creative formatting remains unsupported because the contract supplies no carousel/dynamic-format selector; it fails closed rather than inventing one.

## Latest Verification

| Command | Result |
|---|---|
| `npm update fast-uri qs` | Applied only fixed transitive resolutions; npm's post-update audit stalled after writing the lockfile, then standalone `npm audit` passed |
| `npm test` | Passed; 169 tests, 0 failures |
| `npm run typecheck` | Passed |
| `npm run build` | Passed; includes generation/schema drift check |
| `npm run generate:check` | Passed; no drift |
| `npm audit` | Passed; 0 vulnerabilities |
| `packages/openclaw-plugin npm run check` | Passed; TypeScript build and six-file dry pack |
| `npm run migration:validate -- test/fixtures/migration-inventory.json <missing-evidence>` | Passed; fixture-backed machine-readable pilot `permissions_assets` gate and no mutation |

## Workload Boundary

- Delivery: single PR with maintainer-approved `size:exception`
- Work unit: Unit 6 — OpenClaw plugin, launchd/local operations, and fixture-backed migration validation (implementation complete)
- Tasks 6.1–6.3 are green; archive is intentionally not part of apply.

## Remaining Tasks

- [ ] Run the separate SDD verify phase, then archive only if verification passes.

## Status

16/16 implementation tasks complete. Unit 6 acceptance remediation is green; real pilot, cutover, seven-day observation, rollback exercise, and retirement remain operator work.
