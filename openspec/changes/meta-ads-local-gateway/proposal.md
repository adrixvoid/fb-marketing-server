# Proposal: Meta Ads Local Gateway

## Intent

Implement the private OpenClaw-to-Meta gateway. Requirements and OpenAPI exist, but no runtime enforces them.

## Scope

### In Scope
- Build a loopback-only Node 24/TypeScript service with Fastify, `openapi-backend`, `node:sqlite`, native `fetch`, and Meta v26.0.
- Enforce explicit client/account isolation, encrypted tokens, no secret exposure, audited reads, capabilities, Insights, and pacing.
- Accept chat media bytes only. Support exactly `SALES_WEBSITE`, `LEADS_WEBSITE`, and `LEADS_INSTANT_FORM`; create delivery objects `PAUSED`, with separate activation.
- Add immutable operations, owner-only decisions, 12-hour expiry, revalidation, recovery, and staged migration.

### Out of Scope
- Public exposure, dashboard, Docker/PostgreSQL, arbitrary media URLs/paths, deletion, ranking, or dashboard automation.
- Changing the 14 existing apps; target one agency app while client assets remain client-owned.

## Capabilities

### New Capabilities
- `local-service-foundation`: Contract routing, loopback auth, SQLite, secrets, backups, and LaunchAgent.
- `meta-integration`: Scope/authority resolution, v26.0 transport, capabilities, credentials, generations, and migration.
- `ads-reporting-and-pacing`: Scoped campaigns, Insights, unavailable metrics, and exact timezone-aware pacing.
- `campaign-operations`: Trusted chat media and immutable create/edit/status/budget proposals for three campaign kinds.
- `approval-and-audit`: Owner-only expiry, revalidation, at-most-once execution, recovery, and redacted evidence.
- `openclaw-tooling`: Read/propose model tools and separate deterministic approval commands.

### Modified Capabilities
None; no existing specs are present.

## Approach

Deliver contract-first slices: scaffold/checks; persistence; reads/pacing; media/proposals; owner commands; paused mutations; migration. Disable mutations until approval, audit, and recovery pass. Add dependencies per slice. Keep `strict_tdd: false` until scaffold checks run.

## Affected Areas

| Area | Impact |
|---|---|
| Scaffold, `src/`, `test/` | New service and checks |
| OpenClaw plugin, LaunchAgent, local data | New integration and operations |
| `openspec/config.yaml` | Re-detect testing after scaffold |

## Risks

| Risk | Mitigation |
|---|---|
| Over 400 review lines | Plan vertical units; tasks phase reassesses PR strategy. |
| Partial writes, leaks, or tenant crossover | Central gates, canaries, persisted steps; never retry ambiguous writes. |
| SDK/timezone mismatch | Verify installed SDK and boundary fixtures before enablement. |

## Rollback Plan

Feature-gate mutations, restore protected SQLite state, and revert integration generation. Migrate per client; retain each prior integration for at least 7 days and all 14 apps until exit evidence passes.

## Dependencies

- Canonical contract/docs, Meta access evidence, Keychain/launchd, and verified OpenClaw SDK.

## Success Criteria

- [ ] Invalid scope fails before Meta access; canary scans show no token exposure.
- [ ] Both pilot accounts independently pass capabilities, metrics, pacing, and redacted audit checks.
- [ ] Each campaign kind creates one paused bundle after valid approval; activation is separate, expiry is exact at 12 hours, and replay/restart cannot duplicate execution.
- [ ] Central-app pilot, reversible mutation, restore, and 7-day rollback evidence pass.
