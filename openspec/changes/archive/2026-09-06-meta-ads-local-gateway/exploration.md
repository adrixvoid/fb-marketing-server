## Exploration: meta-ads-local-gateway

### Current State

The repository is planning-only. It contains the canonical OpenAPI 3.1.1 contract, requirements, architecture, operating runbooks, and a Node `24.19.0` pin, but no `package.json`, application source, dependencies, lockfile, or tests. Node `24.19.0` and npm `11.17.0` are available through nvm. The runtime reports `Temporal` as unavailable, which matters for timezone-correct pacing.

The approved boundary is already specific: a Fastify and `openapi-backend` service bound to `127.0.0.1`, called only by OpenClaw, using `node:sqlite` and native `fetch` against fixed Meta API `v26.0`. Every Meta call resolves an explicit client/account pair and appends redacted audit evidence. Reads and dynamic capability discovery may run after authorization; mutations are immutable proposals executed only by deterministic owner-only OpenClaw commands. Existing client integrations remain valid while a central agency integration is proven and adopted one client at a time.

The contract is broad enough that a complete implementation cannot be a credible sub-400-line single PR. The smallest safe change is therefore a sequence of complete vertical work units under this named change, not a big-bang scaffold or placeholder handlers that falsely claim contract coverage.

### Affected Areas

- `openapi.yaml` — remains the machine boundary; implementation must route by `operationId`, validate requests and explicit responses, and preserve its exact scope, error, operation, media, capability, and campaign-bundle semantics. No contract edit is currently indicated.
- `docs/requirements.md` — supplies normative behavior and acceptance criteria, especially explicit scope, owner-only approval, pacing, audit, media provenance, and migration generations. Preserve unchanged.
- `docs/architecture.md` — supplies trust boundaries, lifecycle sequencing, authority intersection, and phased rollout. Preserve unchanged.
- `docs/technology.md` — supplies the dependency ceiling and native-first choices. Add packages only when their implementing slice begins.
- `docs/meta-setup.md` — controls inventory, pilot, central integration proof, cutover, rollback, and retirement; implementation must store evidence without automating changing Meta dashboard steps.
- `docs/remote-access.md` — constrains runtime binding, service authentication, OpenClaw exposure, and secret handling.
- `openspec/config.yaml` — testing capability is currently correctly marked unavailable; re-detect and update it immediately after the scaffold creates runnable scripts.
- `package.json`, lockfile, and TypeScript configuration (new) — minimal ESM scaffold, exact versions, scripts, and Node engine pin. Do not install the full future dependency list up front.
- `src/app.ts` and `src/main.ts` (new, indicative names) — testable Fastify construction, `openapi-backend` dispatch/security/response validation, centralized problem mapping, and explicit `127.0.0.1` startup.
- `src/db.ts` (new, initially one persistence module) — `node:sqlite`, `PRAGMA user_version` migrations, WAL, foreign keys, prepared SQL, integration generations, immutable operation data, audit events, and backup entry points. Split only when the module demonstrably becomes hard to review.
- `src/meta.ts` (new) — the only Meta transport path: fixed `v26.0`, native fetch, app-secret proof, timeouts, bounded safe retries, pagination/polling, normalized errors, and audit wrapping.
- Domain modules for scope/capabilities/pacing/media/operations (new only as their slices begin) — central scope resolution, opaque bound cursors, exact pacing, trusted attachment staging, canonical payload hashing, proposal lifecycle, revalidation, and campaign-bundle orchestration.
- OpenClaw plugin integration (new; exact path deferred) — curated model tools plus deterministic `/approve-ad` and `/reject-ad` commands. The installed host SDK/version must be inspected before choosing imports or package layout; it is not present in this repository.
- `test/` (new) — `node:test`, Fastify `inject()`, temporary SQLite databases, stubbed native fetch, fixed time/zone fixtures, and canary leak scans.
- LaunchAgent/install and backup/restore assets (new, final local-operability slice) — stable absolute Node path, loopback verification, redacted logs, Keychain access, and restore proof.

### Approaches

1. **Contract-first vertical work units** — establish one real request path, then add persistence and audited reads, media, proposals, owner commands, and mutations in dependency order. Keep all canonical behavior in scope, but enable no mutation before its approval and recovery controls exist.
   - Pros: Each slice is runnable and reversible; security boundaries are built before dangerous behavior; dependencies arrive only when used; pilot evidence maps cleanly to the delivery phases.
   - Cons: The full change spans several review units and requires strict feature gating between read-only and mutation phases.
   - Effort: High overall, low-to-medium per work unit.

2. **Big-bang full-contract implementation** — scaffold every endpoint, persistence concept, OpenClaw command, and Meta mutation together.
   - Pros: One nominal delivery event.
   - Cons: Far beyond the 400-line review budget; mixes unverified Meta behavior with security-critical lifecycle code; encourages stubs, missed audit paths, and unsafe partial-write recovery.
   - Effort: High and difficult to verify.

3. **Framework-generated or infrastructure-heavy foundation** — add generated server code, ORM, job framework, Meta SDK, broad validation libraries, and separate services before endpoint work.
   - Pros: More prebuilt abstractions.
   - Cons: Conflicts with the documented local single-process architecture, adds migration and supply-chain surface, and does not solve Meta authority, idempotency, audit, or approval semantics. Generated code from the large contract would also consume the review budget before domain behavior exists.
   - Effort: High with no demonstrated MVP benefit.

### Recommendation

Use contract-first vertical work units, with the following sequence:

1. **Scaffold and re-detect testing.** Add only Fastify, `openapi-backend`, TypeScript, and Node types; create build/test/typecheck scripts and immediately re-run SDD testing detection. Use `node:test` and Fastify `inject()` rather than adding a test framework or Supertest.
2. **Secure contract harness.** Initialize `openapi-backend` before serving, route by operation ID, validate the service bearer, preserve/generate request IDs, validate responses through `postResponseHandler`, normalize secret-free errors, set conservative body limits, and bind explicitly to `127.0.0.1`. Start with `/health` and contract-failure tests; do not expose CORS, Swagger, cookies, or public TLS concerns that this boundary does not need.
3. **Persistence, scope, credentials, and audit.** Add `node:sqlite` with defensive defaults, WAL, foreign keys, prepared statements, explicit transactions, `user_version` migrations, and backup/restore checks. Model multiple integrations and immutable generations from day one so existing apps and the future central app coexist. Retrieve the encryption key through a fixed-argument, no-shell Keychain adapter. Centralize scope resolution before Meta credential selection.
4. **Audited Meta reads and discovery.** Implement one `MetaClient` wrapper so every outbound attempt records redacted start/outcome evidence and no handler can bypass audit. Deliver integration status, scopes, campaigns, capabilities, Insights, then pacing. Add `decimal.js` only when pacing starts. Use native `fetch`; do not add Axios or the Meta SDK.
5. **Pacing proof before rollout.** Node `24.19.0` has no global `Temporal`. First prove a small `Intl`-based zoned-month helper against ordinary, month-boundary, DST, zero-progress, unavailable-spend, and unavailable-timezone fixtures. Add a timezone dependency only if that proof cannot satisfy AC-5 reliably; do not hand-wave timezone boundaries.
6. **Trusted chat media.** Add `@fastify/multipart` and `file-type` only for this slice. Treat multipart as a dedicated streaming boundary, enforce field/byte/count limits, sniff content, generate storage IDs, never interpret the original filename as a path, hash while staging privately, and clean up on completion or expiry. Do not add image/video transformation.
7. **Immutable proposals.** Add stable recursive canonical JSON hashing with a focused test, permanent idempotency-key reservation, append-only lifecycle records, generation/media binding, and proposal-time capability revalidation. Use an HMAC-signed base64url cursor for caller/scope/filter binding rather than server-side cursor infrastructure.
8. **Owner command boundary and execution.** Inspect the actual OpenClaw public SDK first. Keep model tools read/propose-only. Implement approval/rejection as native deterministic commands requiring the configured channel-scoped owner. Use a command-only HMAC proof built with `node:crypto`, bound to action, operation, owner identity, timestamp, and nonce; enforce a short TTL and single-use nonce without adding JWT. Revalidate scope, budget, authority, integration generation, and media immediately before execution.
9. **Mutation enablement and local operations.** Persist each external object ID before advancing through the complete Campaign/Ad Set/Creative/Ad bundle, create delivery objects paused, never retry an ambiguous write, and reconcile partial external success after restart. Enable activation only as a separate approved operation. Finish with LaunchAgent, Keychain-under-launchd, logs, backup/restore, canary leak scan, pilot read proof, reversible mutation, and rollback evidence.

Do not add `openapi-typescript`, `yaml`, `tsx`, multipart, decimal, or file inspection tooling until the slice that actually uses each package. Native Node type stripping is not a substitute for a verified production TypeScript build; use the smallest conventional compiler setup first. Keep `openapi.yaml` and the canonical docs unchanged unless implementation discovers a real contract contradiction.

Delivery should be planned as reviewable work units even though the default strategy is a single PR. A single PR containing the whole approved gateway is a high review-risk exception; the tasks phase should forecast line count and recommend a chain if the implementation cannot stay within the 400-line budget.

### Risks

- **Review size:** The canonical contract has 11 operations and extensive schemas; full implementation will greatly exceed 400 changed lines, especially with a lockfile and tests.
- **OpenClaw integration uncertainty:** No application or host SDK is installed here. Public imports, attachment context, owner identity fields, and command APIs must be verified against the deployed OpenClaw version before coding.
- **Approval proof gap:** The contract requires a short-lived owner-command proof but does not prescribe its protocol. Design must make the HMAC binding, TTL, nonce persistence, rotation, and failure behavior explicit.
- **External at-most-once limits:** Meta campaign bundles are multi-call and cannot be made transactionally atomic with SQLite. A crash can leave partial paused objects; persisted step results and reconciliation are mandatory, and blind retry is forbidden.
- **Audit crash window:** Recording only after fetch can lose evidence on process failure. Append a pre-dispatch event and a terminal outcome/unknown reconciliation event through the central Meta wrapper.
- **Timezone correctness:** `Temporal` is absent in the pinned runtime. Manual timezone conversion is easy to get wrong at DST and unusual local-midnight transitions; fixtures must decide whether native `Intl` is sufficient.
- **Multipart validation:** `openapi-backend` does not provide normal parsed-body validation for the streaming media path. Fastify multipart limits and explicit field/content validation remain required.
- **Schema compatibility:** `openapi-backend` advertises OpenAPI 3.1 support, but the contract's discriminators, `unevaluatedProperties`, conditionals, and response unions need an early executable compatibility check.
- **Synchronous SQLite:** `DatabaseSync` fits one local process but can block the event loop during long migrations/backups. Keep request transactions short and run backups outside request handling; switch libraries only after measured failure.
- **Keychain under LaunchAgent:** Non-interactive Keychain access and a stable absolute Node executable must be proven on the deployment account before calling local operations complete.
- **Meta authority and migration:** Central integration success for one pilot account does not prove another scope. Keep all 14 apps untouched during inventory, validate both pilot accounts independently, bind operations to generations, freeze/reconcile per-client cutovers, and retain rollback for at least seven days.

### Ready for Proposal

Yes. The proposal should preserve the full approved gateway scope but define vertical, feature-gated delivery and explicitly state that read-only foundation precedes owner-command infrastructure and all mutation enablement. It should not invent OpenClaw SDK details, alter the OpenAPI contract, add speculative dependencies, automate Meta dashboard setup, or collapse the gradual integration migration into a one-time cutover.
