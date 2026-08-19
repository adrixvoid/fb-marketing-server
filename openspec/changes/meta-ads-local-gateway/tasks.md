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

Unit 4 acceptance complete: migration v2 owns only constrained staged-media, immutable proposal/idempotency/media-link, proof-nonce, decision, and audit-link state; private streamed media, typed proposals, and deterministic owner decisions are production-wired. Approval ends with an immutable approved decision while the operation remains contract-valid `pending` for Unit 5 claiming, or terminal `rejected`; no Meta mutation or campaign bundle execution exists yet.

## Phase 5: Campaign Bundle and Reconciliation

- [ ] 5.1 Persist steps for one Campaign, Ad Set, Creative, and Ad; verify delivery objects stay `PAUSED` pending separate activation.
- [ ] 5.2 Add partial-bundle reconciliation and ambiguous-write pause; test restart never duplicates mutations.

## Phase 6: OpenClaw, launchd, and Migration Validation

- [ ] 6.1 Create `packages/openclaw-plugin` after SDK verification; test exactly nine tools, trusted attachments, and no approval tools.
- [ ] 6.2 Add owner commands, replay-safe proof, and `scripts/install-launchagent.ts`; test authorization, stable runtime, startup, and redacted logs.
- [ ] 6.3 Validate two-account reads, reversible mutation, restore, per-client cutover/reconciliation, and seven-day rollback before retiring 14 apps.
