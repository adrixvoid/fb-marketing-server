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

## Dependency State

- Runtime: `@fastify/multipart`, `@js-temporal/polyfill`, `ajv`, `ajv-formats`, `decimal.js`, `fastify`, `file-type@22.0.2`, `openapi-backend`, `yaml`.
- Development: Node 24 typings, `openapi-typescript`, `tsx`, TypeScript.
- Future-slice dependencies and OpenClaw remain absent.

## Contract and Architecture Decisions

- `openapi-backend` quick mode remains routing/security/request plumbing only; AJV 2020 is authoritative for OpenAPI 3.1 validation.
- Every centralized operation now declares reusable `500 InternalError` with project-required `X-Request-ID` and `application/problem+json` `Problem500`.
- Normalized internal errors are validated once against the original operation's exact 500 response before transmission.
- If that validation fails or the operation/schema is absent, a minimal `text/plain` emergency response is sent with `x-contract-validation: failed`; it is intentionally not called contract-valid.
- Response media and headers remain case-insensitive, and AppOptions overrides remain limited to operation IDs.
- OpenClaw tool schemas remain deferred to Unit 6.
- SQLite file and backup artifacts use owner-only `0600` permissions; file databases use WAL while `:memory:` remains supported for tests.
- Credentials use random-IV AES-256-GCM with stable credential/generation/subject AAD; only the key reference and ciphertext envelope enter SQLite.
- Scope resolution requires one active client/account mapping, validated active generation, active credential, complete authority flags, and requested task/permission before downstream work.
- Audit rows accept only explicit metadata/evidence fields and are protected from update/delete by SQLite triggers.
- `/usr/bin/security add-generic-password -w` is invoked with `-w` last and receives secret bytes through stdin, matching the CLI's documented prompt mode; secrets never enter argv or retained subprocess errors.
- File-backed operations require an explicit trusted data root. Backups/restores reject unsafe paths and existing targets, validate integrity plus the exact supported schema/version in a protected temporary file, then atomically rename.
- Prompt, model-tool, chat, and Meta mutation canary surfaces remain deferred to their Unit 5/6 owners; Unit 4 proposal, proof, decision, media, response, SQLite, and audit canaries are executable.
- Keychain commands have a 10-second default timeout. Timeout aborts the injected runner and kills the real spawned child with `SIGKILL`; timers are cleared on every completion path.
- Backup authenticity uses a deterministic SHA-256 fingerprint derived from a fresh in-memory execution of canonical migrations through v2. The fingerprint includes normalized `sqlite_schema`, table columns, foreign keys, indexes, index columns, CHECK/UNIQUE SQL, and triggers; restore also requires clean integrity and foreign-key checks.
- Backup work occurs in a generated `0700` directory under the trusted root. The final destination and temporary SQLite file are both atomically reserved at `0600` before backup writes; sidecars remain confined by the private directory.
- Meta transport pins `v26.0`, obtains credentials just in time, signs `appsecret_proof`, retries only bounded safe GET attempts, ignores absolute pagination URLs in favor of opaque cursors, and audits every attempt/poll/page.
- Meta transport bounds response bodies to 10 MiB and keeps one timeout active across fetch/header acquisition and streamed body consumption, even for injected fetch implementations that ignore `AbortSignal`.
- Reporting cursors are HMAC-bound to caller, scope, filters, and limit; capability discovery paginates all dependent edges and derives status from authoritative permissions, Ad Account tasks, and asset prerequisites.
- Reporting and pacing handlers create one request ID per invocation and propagate it through response headers/bodies, normalized errors, service calls, Meta transport, and audit rows.
- Pacing imports the Temporal polyfill locally, rejects non-canonical decimal spellings before 50-digit Decimal round-half-even arithmetic, and uses pinned Node ICU currency precision; unknown codes fail closed.
- OpenAPI maps pacing's `available` and `unavailable` discriminator values explicitly, and `Retry-After` is a canonical nonnegative integer string in runtime and generated types.
- Migration v2 owns only Unit 4 tables: `staged_media`, `operations`, `operation_idempotency`, `operation_media`, `proof_nonces`, `approval_decisions`, and `operation_audit_links`; constraints, composite foreign keys, and immutable/status-transition triggers enforce scope, payload, nonce, decision, and audit linkage.
- Media accepts exactly one trusted multipart file plus three fields, validates declared and actual JPEG/PNG/MP4 content under a total deadline and 25 MiB streaming bound, publishes random `0600` files only below a validated private `0700` root, and never exposes storage paths.
- Proposal idempotency permanently binds actor, operation type, scope, key, and canonical payload hash. Approval/proposal revalidation uses scoped capabilities, active generation/credential authority, targets, currency, schedules, and bound file hashes; no Meta writes occur in Unit 4.
- Owner proof is HMAC-SHA256 over version, uppercase method, raw path/query, decision, operation ID, exact body hash, configured channel-scoped owner, Unix timestamp, and canonical nonce. It is fresh for 300 seconds with no future issue time; nonces and decisions are immutable and replay-safe.
- An approved decision leaves the operation `pending` and returns contract-valid 202 for Unit 5 to claim later; rejection returns 200 and terminally cleans media. Unit 4 never creates Campaign, Ad Set, Creative, Ad, execution, or step rows.

## Latest Verification

| Command | Result |
|---|---|
| `npm install` | Passed; exact Unit 3 dependencies plus `file-type@22.0.2` installed |
| `npm test` | Passed; 102 tests, 0 failures |
| `npm run typecheck` | Passed |
| `npm run build` | Passed; includes generation/schema drift check |
| `npm run generate:check` | Passed; no drift |
| `npm audit` | Passed; 0 vulnerabilities |

## Workload Boundary

- Delivery: single PR with maintainer-approved `size:exception`
- Work unit: Unit 4 — secure media, immutable proposals, and owner approval/rejection (complete)
- Tasks 4.1–4.3 are green; campaign bundle execution and all Unit 5+ work were not implemented.

## Remaining Tasks

- [ ] 5.1–5.2 bundles/reconciliation
- [ ] 6.1–6.3 OpenClaw/launchd/migration

## Status

11/16 tasks complete. Unit 4 tasks 4.1–4.3 are green and ready for the Unit 4 verification gate; Unit 5+ remains unchecked.
