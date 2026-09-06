# Campaign Operations Specification

## Purpose

Define trusted chat media and immutable typed mutation proposals, including complete campaign bundles for exactly three campaign kinds. (FR-5–6; NFR-3, NFR-8)

## Requirements

### Requirement: Trusted chat attachment media

Creative media MUST originate from exactly one fresh host-trusted attachment on the same authorized owner event carrying `/stage-ad-media <client_id> <ad_account_id>`, never model execution, mutable latest-message state, a model path, or a URL. The plugin MUST reject missing, multiple, pending, expired, unsafe, out-of-root, and symlink inputs before calling the authenticated staging endpoint. The service MUST preserve explicit scope authorization, validate multipart fields, byte limits, declared and actual content, and filename; hash and scope-bind accepted bytes; and remove staged content after completion or expiry. `original_filename` MUST be basename display metadata of 1–255 characters and MUST reject slash, backslash, and control characters.

#### Scenario: Valid attachment

- GIVEN trusted supported attachment bytes and metadata for an authorized scope
- WHEN media is staged
- THEN validated bytes MUST be privately stored, hashed, and bound to that scope

#### Scenario: Untrusted media source

- GIVEN no trusted attachment context, a model path or URL, or invalid content
- WHEN upload is requested
- THEN it MUST fail before Meta access and MUST NOT stage usable media

### Requirement: Exactly three typed campaign kinds

Creation MUST accept only `SALES_WEBSITE`, `LEADS_WEBSITE`, and `LEADS_INSTANT_FORM` and MUST derive their fixed objective, destination, optimization goal, billing event, and conversion event. Website kinds MUST require a runtime-valid pixel and HTTPS URL; instant forms MUST require a runtime-valid Page and matching published usable lead form. Caller-supplied derived combinations MUST NOT be accepted.

#### Scenario: Supported website proposal

- GIVEN `SALES_WEBSITE`, a valid pixel, HTTPS URL, allowed CTA, and bound media
- WHEN proposal semantics are validated
- THEN the fixed sales combination MUST be selected without caller override

#### Scenario: Invalid instant form

- GIVEN `LEADS_INSTANT_FORM` with a form that does not match its Page
- WHEN proposal validation runs
- THEN the proposal MUST be rejected before persistent creation

### Requirement: Immutable typed mutation proposals

Complete create, object update, delivery change, and monthly-budget requests MUST create immutable scoped pending operations and MUST NOT execute from proposal creation. Dynamic assets, bound media, local semantics, and mutation targets MUST be validated at creation. An idempotency key MUST bind caller, operation type, scope, and canonical payload hash permanently.

#### Scenario: New proposal

- GIVEN a valid typed mutation and unused idempotency key
- WHEN it is proposed
- THEN one immutable pending operation MUST be stored without executing the mutation

#### Scenario: Matching idempotency reuse

- GIVEN an existing operation and its idempotency key
- WHEN the same canonical payload is retried
- THEN the existing immutable operation MUST be returned

#### Scenario: Conflicting idempotency reuse

- GIVEN an existing operation and its idempotency key
- WHEN a different canonical payload reuses that key
- THEN the service MUST return `409 idempotency_conflict`

### Requirement: Paused bundle and separate activation

After valid approval, campaign creation MUST produce exactly one Campaign, Ad Set, Creative, and Ad. Campaign, Ad Set, and Ad MUST be created `PAUSED`; Creative MUST be created and bound without delivery status. Activation MUST be a separate immutable operation and approval, and delivery transitions MUST apply only to Campaign, Ad Set, and Ad.

#### Scenario: Approved bundle creation

- GIVEN a valid approved campaign-bundle operation
- WHEN execution succeeds
- THEN exactly four objects MUST be returned with only Campaign, Ad Set, and Ad marked `PAUSED`

#### Scenario: Activation attempt during creation

- GIVEN newly created delivery objects
- WHEN creation completes without a separate activation approval
- THEN every delivery object MUST remain `PAUSED`
