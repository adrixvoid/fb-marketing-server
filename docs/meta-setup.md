# Meta setup, pilot, and migration runbook

Preserve the 14 existing Meta Developer Apps while building and proving the agency-owned integration. Complete Phase 0 inventory first, establish the agency portfolio and app, validate one pilot portfolio with two Ad Accounts read-only, prove approval infrastructure, run one reversible mutation, and migrate clients individually with rollback.

## Target outcome

```text
Agency Business Portfolio 3981018332186282
  owns: central Meta Business App
  owns: agency System User
  receives: partner access to selected client Business Assets and tasks
  assigns: those assets and tasks to the System User

Client Business Portfolio
  retains ownership of: Ad Accounts, Pages, Instagram accounts,
                        pixels/datasets, catalogs, and related assets
```

The central app is the project target, not a Meta mandate. Use the canonical [Meta concepts](architecture.md#meta-concepts), [authority formula](architecture.md#effective-authority), [partner lifecycle](architecture.md#partner-access-lifecycle), and [integration states](architecture.md#integration-states) when executing this runbook.

The MVP endpoint inventory and pilot evidence target Meta Graph/Marketing API `v26.0` as of 2026-08-18. Treat later versions as planned migrations: revalidate endpoints, permissions, payloads, fixtures, and one scoped pilot before rollout.

## Known estate

| Item | Current fact |
|---|---|
| Existing Developer Apps | 14 total; five belong to one client. |
| Portfolio distribution | Apps are distributed among multiple Business Portfolios. |
| Existing configuration | Most apps have configured permissions, App Secrets, and tokens; some may be incomplete. |
| Agency portfolio | `3981018332186282`; not yet Business Verified and not yet a partner of client portfolios. |
| Pilot portfolio | `290166249089842`; contains two Ad Accounts. |
| Initial policy | Do not delete, consolidate, revoke, or repoint existing integrations during inventory and foundation work. |

The agency and pilot Business IDs are identifiers, not secrets.

## Phase 0: Freeze and inventory

- [ ] Record all 14 Developer Apps before making agency-side changes.
- [ ] Confirm the five apps associated with the same client remain separate inventory entries.
- [ ] Record the owning Business Portfolio and legally distinct client for every app.
- [ ] Record App ID and secret presence; do not place App Secrets in the inventory document or logs.
- [ ] Record token subject type, app binding, scopes, lifecycle evidence, and last validation time; do not record plaintext tokens.
- [ ] Map every authorized Ad Account and other Business Asset to its owning client portfolio.
- [ ] Record current permissions/access levels and the endpoints actually used.
- [ ] Record partner relationships, System User assignments, asset tasks, known failures, and an operational owner.
- [ ] Assign one actionable integration state and capture evidence for it.
- [ ] Record the current integration's rollback procedure before any migration.

Recommended inventory fields:

| Identity | Ownership | Authority | Health | Operations |
|---|---|---|---|---|
| Integration ID, App ID, app name | Client ID, app-owning portfolio, asset-owning portfolio | Token subject, scopes, app review/access, partner relationship, assigned assets/tasks | State, last validation, diagnostic result, gap | Owner, current usage, replacement target, rollback procedure |

## Inventory validation

- [ ] Assign one canonical [integration state](architecture.md#integration-states) from retained validation evidence.
- [ ] Treat the state as an operator instruction and resolve its stated gap before activation.
- [ ] Never select another credential merely because it works; validate the complete [effective authority](architecture.md#effective-authority) for the same client and asset.

## Prepare the agency portfolio

Agency Business Portfolio: `3981018332186282`.

- [ ] Confirm the agency's legal details and authorized administrators.
- [ ] Complete Meta Business Verification using the current requirements shown by Meta.
- [ ] Record verification status and evidence without copying sensitive documents into this repository.
- [ ] Create one new Meta Business App owned by the agency portfolio.
- [ ] Record its App ID and store its App Secret only in approved encrypted storage.
- [ ] Request App Review and Advanced Access for `ads_read`, `ads_management`, and any other permissions required by the confirmed endpoint inventory.
- [ ] Validate each requested permission against a real planned endpoint; do not request speculative permissions.
- [ ] Create an agency System User with the minimum role and tasks required for the integration.
- [ ] Generate an app-bound System User token with only the required scopes after the app and access prerequisites permit it.
- [ ] Store the token encrypted; keep its encryption key in macOS Keychain.
- [ ] Record token app binding, subject, scopes, issuance evidence, validation time, and revocation procedure.

Do not encode exact dashboard navigation in automation or policy: Meta can change setup screens and may present requirements conditionally. Record the requirement and evidence Meta presents at execution time.

Facebook Login for Business is not inherently required for this manually provisioned System User integration. Reassess only if Meta's current requirements for a selected endpoint or authorization flow require it.

## Establish client partner access

Repeat this for each legally distinct client portfolio.

- [ ] Confirm the client portfolio owns the intended Business Assets.
- [ ] Have an authorized client administrator grant or accept agency portfolio `3981018332186282` as a partner and share only the required assets/tasks.
- [ ] Record the request as `pending`, then `accepted`, with actor, timestamp, exact assets/tasks, and redacted Meta evidence.
- [ ] Confirm ownership remains with the client portfolio.
- [ ] After acceptance, have an authorized agency administrator assign the received assets and minimum required tasks to the agency System User.
- [ ] Record assignment status, actor, timestamp, and redacted validation evidence; do not infer access from the request.
- [ ] Map each shared asset to the correct internal `client_id` and external asset ID.
- [ ] Validate access separately for each asset; one successful account does not prove another.
- [ ] Record who can revoke partner access and the rollback steps.

## Validate credentials and authority

For every app/token/asset combination, validate the complete authority intersection:

- [ ] App is owned by the expected Business Portfolio.
- [ ] Required permission has the necessary review and access level.
- [ ] Token is valid, app-bound as expected, and carries the required scopes.
- [ ] Token subject is the expected System User or authorized human identity.
- [ ] Agency-to-client partner relationship is active where required.
- [ ] Target asset is assigned to the token subject with the required tasks.
- [ ] Planned endpoint accepts this app, subject, scope, asset, and task combination.
- [ ] Diagnostic evidence is timestamped, redacted, and linked to the integration record.
- [ ] Failed authority produces the appropriate actionable state rather than a fallback bypass.

Meta does not provide a standard OAuth `refresh_token` for this model. Existing tokens bound to old apps cannot be transferred to the new central app. So-called permanent System User tokens remain revocable and must be monitored.

Internal scheduled or administrative maintenance may validate credentials, update integration states, and request human reauthorization outside the model-facing HTTP contract. It requires no HTTP endpoint and must not expose public renewal, reveal tokens to OpenClaw or AI, or silently mint replacement authority.

## Run the pilot

Pilot Business Portfolio: `290166249089842`, containing two Ad Accounts.

### Access proof

- [ ] Have an authorized pilot client administrator grant or accept partner access and share each Ad Account separately with only the required tasks.
- [ ] Record `pending` and `accepted` access status plus redacted validation evidence for each account.
- [ ] Have an authorized agency administrator assign both received Ad Accounts separately to the agency System User and record the assignment evidence.
- [ ] Register each account with an explicit `client_id` and `ad_account_id` mapping.
- [ ] Prove account A can be accessed using its own authorization path.
- [ ] Prove account B can be accessed using its own authorization path.
- [ ] Prove a request for either account cannot resolve through the other account's mapping.

### Read-only proof

- [ ] Prove integration status and actionable diagnostics for each account.
- [ ] List both authorized Ad Accounts and confirm each returned ID matches its explicit mapping.
- [ ] List campaigns independently for each account and confirm no campaign from the other account appears.
- [ ] Read a fixed Insights window for each account containing spend, impressions, reach, clicks, CTR, CPC, CPM, results/conversions, cost per result, and ROAS where available.
- [ ] Confirm every unavailable metric has an actionable reason and is not reported as zero.
- [ ] Confirm returned account IDs match the explicit request target.
- [ ] Confirm every Meta call appends immutable, append-only audit metadata identifying client, account, integration generation, actor, correlation ID, logical operation, timestamp, normalized outcome/error, and redacted external evidence without storing tokens, secrets, authorization headers, or complete request/response bodies.
- [ ] Where required Meta data and local budget configuration exist, have OpenClaw compose a global pacing table from `/v1/scopes` and one scoped pacing response per pair, with no ranking, comparison, or cross-currency aggregation.
- [ ] Label unresolved budget concepts rather than combining campaign budgets with spend/account limits.

Complete and accept this read-only proof before enabling approval infrastructure for the pilot mutation.

### Approval infrastructure proof

- [ ] Implement the owner-only deterministic commands and immutable pending-operation controls defined by [SEC-5, SEC-6, NFR-3, and NFR-4](requirements.md).
- [ ] Prove unauthorized, natural-language, changed, expired, completed, replayed, generation-mismatched, and duplicate attempts cannot execute.
- [ ] Prove approval decisions and execution outcomes remain separately linked and auditable across a service restart.
- [ ] Accept this infrastructure evidence before creating the pilot mutation proposal.

### Approved reversible mutation

- [ ] Choose one low-risk, reversible mutation on a non-production or safely controlled object.
- [ ] Capture the exact pre-change value and rollback action.
- [ ] Create an immutable pending operation with explicit client, ad account, object, requested change, and actor; prove it is valid only while `now < created_at + 12 hours` and expired at equality.
- [ ] Obtain `/approve-ad <operation_id>` from the single channel-scoped owner through the deterministic [approval command boundary](architecture.md#approval-identity-and-command-boundary).
- [ ] Execute once and verify retry/idempotency behavior does not apply the change twice.
- [ ] Confirm the audit trail links request, approval, execution, normalized outcome and redacted external evidence, and actor.
- [ ] Execute the rollback under the same approval controls and verify the original state is restored.

### Pilot exit criteria

- [ ] Both Ad Accounts pass independent authority, diagnostics, and metrics checks.
- [ ] Missing permission, token, partner, assignment, or task access produces the correct integration state.
- [ ] The reversible mutation and rollback both complete through the owner-only approval command.
- [ ] The reproducible canary scan in [AC-7](requirements.md#9-acceptance-criteria) passes across every enumerated output surface.
- [ ] Existing pilot integrations remain available as documented rollback paths.
- [ ] The approver accepts the pilot evidence before any client migration begins.

## Migrate client by client

- [ ] Select one client based on inventory completeness and operational readiness, not convenience of credential reuse.
- [ ] Confirm all client-owned assets remain in the client portfolio.
- [ ] Establish partner sharing and System User assignments for the exact required assets/tasks.
- [ ] Validate all required reads and mutations against the central app before changing traffic.
- [ ] Capture baseline results from the existing integration for comparison.
- [ ] Bind every pending operation to the integration generation against which it was validated.
- [ ] Freeze new mutations for the client and drain/reconcile pending, in-flight, and retried work without moving it to replacement credentials.
- [ ] Define rollback triggers for authority regression, endpoint mismatch, duplicate risk, or incomplete audit evidence.
- [ ] Switch only that client's reconciled integrations to the central app and retain the previous generation for rollback.
- [ ] Resume mutations only after reconciliation proves no operation can duplicate or execute with the wrong generation.
- [ ] Monitor diagnostics, reads, approved mutations, and audit completeness for at least 7 days after reconciled cutover and successful validation.
- [ ] Roll back to the retained integration if authority or endpoint validation regresses.
- [ ] Obtain operational acceptance before selecting the next client.

## Retire old integrations

Retirement is evidence-driven and happens only after migration proof.

- [ ] Confirm no active client, asset, workflow, or scheduled operation uses the old app or credential.
- [ ] Confirm the central integration has passed the 7-day observation period and rollback test.
- [ ] Export the final redacted configuration and validation evidence needed for audit.
- [ ] Obtain approval from the responsible app and client owner.
- [ ] Revoke old tokens before deleting app configuration.
- [ ] Remove partner or asset assignments only when they are no longer shared dependencies.
- [ ] Mark the integration retired while preserving non-secret audit history.
- [ ] Delete the old Developer App only when ownership and dependency checks prove it is safe.

## Open questions

- Which client should migrate first after the pilot?
- What evidence and owner approval are mandatory before each old app can be deleted?

## References

- [Target architecture](architecture.md)
- [Secure remote access](remote-access.md)
- [Meta Marketing API authorization](https://developers.facebook.com/docs/marketing-api/overview/authorization/)
- [Meta business-to-business asset management](https://developers.facebook.com/docs/marketing-api/business-asset-management/guides/business-to-business/)
- [Meta System Users](https://developers.facebook.com/docs/marketing-api/businessmanager/systemuser/)
- [Meta App Review](https://developers.facebook.com/docs/app-review/)
- [Meta Business Verification](https://developers.facebook.com/docs/development/release/business-verification/)
- [Meta access tokens](https://developers.facebook.com/docs/facebook-login/guides/access-tokens/)
