# Tasks: Meta Ads Local Gateway

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | 3,500–5,500 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | Units 1 → 2 → 3 → 4 → 5 → 6 |
| Delivery strategy | single-pr with maintainer-approved `size:exception` |
| Chain strategy | size-exception |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: size-exception
400-line budget risk: High

Maintainer-approved `size:exception` recorded before apply. Work units remain mandatory review and rollback boundaries inside the single PR.

## Suggested Work Units

| Unit | Boundary | Verify / rollback |
|---|---|---|
| 1 | Scaffold/contract | Tests, types, drift / revert scaffold |
| 2 | SQLite/security | Transaction, mismatch, canary / restore backup |
| 3 | Reads/reporting/pacing | Fetch and time fixtures / disable routes |
| 4 | Media/approval/recovery | Upload, expiry, replay / disable mutations; purge media |
| 5 | Bundles/reconciliation | Four-object, ambiguous-write / disable; reconcile IDs |
| 6 | Plugin/launchd/migration | Tools, proof, pilot / unload; restore generation |

## Phase 1: Scaffold and Contract Validation

- [x] 1.1 Create Node 24 `package.json`, lockfile, and `tsconfig.json` with build, typecheck, `node:test`, generation, and drift scripts.
- [x] 1.2 Create `scripts/generate-contract.ts` and `src/{contract,app,server}.ts`; test authenticated/untrusted requests and OpenAPI request/response validation (`local-service-foundation`).
- [x] 1.3 Re-detect testing/typecheck into `openspec/config.yaml`, including `strict_tdd`; retain generated outputs only for genuine `openapi.yaml` semantic changes.

## Phase 2: SQLite and Security Foundation

- [x] 2.1 Create `src/{migrations,db}.ts` with WAL, foreign keys, transactions, and backup/restore; test interruption and restore scenarios.
- [x] 2.2 Create `src/{secrets,scope}.ts` and append-only audit; test Keychain separation, mismatch-before-Meta, and canary confinement (`explicit isolated scope`).

Unit 2 acceptance remediation complete: migration v1 is limited to Unit 2 ownership with exact minor-unit budgets, file operations require a trusted root plus canonical-schema-validated atomic backups and close on failed initialization, Keychain secrets use bounded stdin-only child processes, and transaction/audit/crypto/scope lifecycle invariants have executable regression coverage. Fresh verification remains required before Unit 3.

## Phase 3: Meta Reads, Reporting, and Pacing

- [x] 3.1 Create `src/meta-client.ts` with v26.0 endpoints, authority, pagination, safe retries, rate evidence, and audited fake-fetch checks.
- [x] 3.2 Add deterministic capabilities and scoped campaign/async Insights reads in `src/reporting.ts`; test empty pages, unavailable metrics, and account isolation.
- [x] 3.3 Add Temporal/decimal pacing in `src/pacing.ts`; test DST/month start, missing timezone, overspend, and currencies (`exact account-timezone pacing`).

## Phase 4: Operations, Approval, Audit, and Media

- [x] 4.1 Create `src/media.ts` for trusted validated bytes, hashes, scope, and expiry; test valid/untrusted attachment scenarios.
- [x] 4.2 Add immutable proposals/idempotency in `src/operations.ts`; test three campaign kinds, form/Page checks, reuse, and `409` conflict.
- [x] 4.3 Add owner proof, exact expiry, atomic claims, revalidation, linked audits, and restart/replay checks (`approval-and-audit`).

At Unit 4 acceptance, migration v3 hardened the existing v2 Unit 4 invariants, and migration v4 added durable fixed-row approval ingress counters plus controlled expired-unreferenced nonce purge without losing existing evidence. Media authorizes before durable writes, validates container structure including PNG critical-chunk uniqueness/order and contiguous image data, guards root operations, cancels timed-out streams, reconciles terminal files, and shares request correlation. Proposals require usable forms, absolute schedule ordering, deterministic Unicode canonicalization, and a post-async authority check. Approval rechecks proof freshness after secret lookup and at transaction entry, rechecks authoritative generation inside the final transaction, rate-limits before processing, never silently drops admitted audit evidence, permanently retains linked decisions/audits, and rejects every body/framing signal before service or secret access so empty-body proofs cannot authorize chunked bytes. Unit 4 intentionally stopped after an immutable approved decision with the operation still `pending`; Unit 5 now owns its execution claim and mutation lifecycle.

## Phase 5: Campaign Bundle and Reconciliation

- [x] 5.1 Persist steps for one Campaign, Ad Set, Creative, and Ad; verify delivery objects stay `PAUSED` pending separate activation.
- [x] 5.2 Add partial-bundle reconciliation and ambiguous-write pause; test restart never duplicates mutations.

Unit 5 implementation and acceptance are complete after a fresh external SQLite/reconciliation gate reported zero CRITICAL/WARNING findings and the final targeted dependency audit passed. Repaired migration v6 preserves exact compatible v5 result bytes, step correlations, and linked audit evidence while failing closed on incompatible or unaudited history; migration v7 adds predecessor and typed-result hardening; migration v8 fail-closes existing v7 evidence and safely rebuilds constrained execution-audit links without rewriting evidence. SQLite enforces exact operation-specific and media-linked steps, successful predecessors, NULL-safe typed immutable results whose resources match persisted successful steps, operation/execution coupling, and transactionally linked runtime audits. Execution revalidates before claim and each irreversible write, uploads bound image/video bytes, creates Campaign → Ad Set → Creative → Ad with only delivery objects `PAUSED`, supports typed object/delivery/local-budget mutations, and cleans terminal media. Startup preserves the original execution request ID, resumes only persisted successful partial steps, and never redispatches uncertain writes. The lockfile now resolves fixed transitive `fast-uri` 3.1.7/4.1.4 and `qs` 6.16.0 without direct dependencies, overrides, or parent bumps. No execution or reconciliation endpoint was invented; the existing owner-only approval route and startup recovery path implement the canonical contract.

## Phase 6: OpenClaw, launchd, and Migration Validation

- [x] 6.1 Create `packages/openclaw-plugin` after SDK verification; test exactly nine tools, trusted attachments, and no approval tools.
- [x] 6.2 Add owner commands, replay-safe proof, and `scripts/install-launchagent.ts`; test authorization, stable runtime, startup, and redacted logs.
- [x] 6.3 Implement and fixture-test the migration validator for two-account reads, reversible mutation, restore, per-client cutover/reconciliation, seven-day observation, rollback, and retirement gates.

Unit 6 acceptance remediation is complete with 201 passing tests. Trusted upload metadata now carries a channel-derived source and opaque message/attachment identity through the real plugin-to-Fastify boundary. The existing `budget_summary` tool can compose independently correlated pacing rows by paging authorized scopes, while all model-tool failures expose only local allowlisted scope, remediation, status, and request correlation. Read and proposal integration tests prove authority separation. The migration validator and fixture-backed rollout gates are implemented and tested; the real pilot, cutover, seven-day observation, rollback exercise, and retirement remain operator work. Archive remains a separate phase.
