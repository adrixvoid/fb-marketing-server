# Meta Integration Specification

## Purpose

Define explicit Meta scope and authority, safe capability discovery, credential diagnostics, integration generations, and gradual migration. (FR-1–3, FR-8–9, FR-11, FR-20–27; SEC-7–9)

## Requirements

### Requirement: Explicit isolated scope

Every Meta call and scoped operation MUST resolve an explicit `client_id` and `ad_account_id` pair and fail closed on missing, ambiguous, mismatched, or unauthorized mappings without fallback or Meta access. Only authenticated `/health`, paginated `/v1/scopes`, and safe `/v1/integration-status` MAY be unscoped discovery.

#### Scenario: Authorized pair

- GIVEN an authorized client and Ad Account mapping
- WHEN a scoped request is resolved
- THEN the response MUST preserve supplied IDs and label the resolved client and account

#### Scenario: Mismatched pair

- GIVEN IDs from different mappings
- WHEN resolution runs
- THEN it MUST preserve supplied values, expose no invented resolved labels, and make no Meta call

### Requirement: Effective Meta authority

A Meta call MUST proceed only when app access, token validity and scopes, subject authority, partner relationship, asset assignment/tasks, and endpoint requirements authorize the resolved client and asset. Missing authority MUST yield actionable feedback without bypass or silent credential substitution.

#### Scenario: Complete authority

- GIVEN every authority element is valid for the resolved scope and endpoint
- WHEN a Meta call is requested
- THEN the explicitly bound credential MAY be used

#### Scenario: Missing asset task

- GIVEN a valid token without a required asset task
- WHEN access is checked
- THEN the call MUST not proceed and the result MUST identify actionable asset access remediation

### Requirement: Dynamic secret-free capabilities

Scoped capabilities MUST deterministically page accessible Pages, pixels, web datasets, published usable lead forms with their Pages, and relevant Instagram Accounts. Every page MUST repeat resolved identity, integration and account metadata, exactly the three supported campaign kinds, capability statuses, and actionable secret-free gaps; null currency or timezone MUST have its corresponding gap. Dynamic IDs MUST remain opaque, confer no authority, and be revalidated at proposal and execution.

#### Scenario: Capability page

- GIVEN an authorized pair and asset filter
- WHEN capabilities are requested
- THEN only accessible typed assets MUST be returned in deterministic order without mutation

#### Scenario: Unavailable capability

- GIVEN a missing permission or account metadata value
- WHEN capabilities are returned
- THEN each unavailable diagnostic code MUST match exactly one gap and no value or secret MUST be fabricated

#### Scenario: Capability scope error

- GIVEN invalid, unauthorized, forbidden, or mismatched capability query IDs
- WHEN a `400`, `401`, `403`, or `409` response is produced
- THEN supplied values MUST be preserved exactly and `resolved_scope` MUST be absent; mismatch MUST include both IDs

### Requirement: Credential lifecycle and reversible migration

Credential maintenance and human reauthorization MUST run outside model-facing HTTP; safe integration status MUST use the documented actionable states without exposing renewal or secrets. Existing app-bound tokens MUST NOT transfer generations. Migration MUST preserve all 14 apps initially, move one client at a time after freezing and reconciling mutations, and retain the prior integration for rollback for at least 7 days after reconciled cutover and successful replacement validation.

#### Scenario: Diagnostic lifecycle

- GIVEN invalid credentials, missing permissions, or missing partner access
- WHEN validation runs
- THEN safe status MUST report the corresponding actionable state and redacted evidence

#### Scenario: Client cutover

- GIVEN replacement authority is validated and in-flight work is reconciled to its generation
- WHEN one client cuts over
- THEN the old generation MUST remain a rollback path for at least 7 days and retirement MUST wait for exit evidence
