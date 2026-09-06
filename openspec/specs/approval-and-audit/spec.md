# Approval and Audit Specification

## Purpose

Define immutable owner-only decisions, exact expiry, execution revalidation, at-most-once recovery, and redacted evidence for every Meta call. (SEC-5–6; NFR-3–4, NFR-8–9)

## Requirements

### Requirement: Deterministic owner-only decisions

Exactly one configured channel-scoped owner MUST approve or reject through deterministic OpenClaw commands outside model dispatch. Natural-language consent, model output, unauthorized senders, and bare unscoped identities MUST NOT decide an operation. Decisions MUST be immutable records separate from the pending operation.

#### Scenario: Authorized approval

- GIVEN OpenClaw has authenticated the configured channel-scoped owner
- WHEN the deterministic command targets a pending operation
- THEN the decision MUST bind to that operation's stored payload identity

#### Scenario: Model-originated consent

- GIVEN chat text or a model tool requests approval
- WHEN no deterministic owner command is established
- THEN no approval or execution MUST occur

### Requirement: Exact expiry and revalidation

A pending operation MUST be valid only while `now < created_at + 12 hours`; equality or later MUST be expired. Immediately before execution, the service MUST revalidate target, budget, effective Meta authority, credential generation, and each bound media hash against the immutable payload.

#### Scenario: Before expiry

- GIVEN every revalidation passes at an instant before `expires_at`
- WHEN the owner approves
- THEN execution MAY begin for the exact stored operation

#### Scenario: Expiry boundary

- GIVEN `now` equals `created_at + 12 hours`
- WHEN approval or rejection is attempted
- THEN the operation MUST be expired and MUST NOT execute

#### Scenario: Stale generation

- GIVEN the operation's integration generation differs from the active validated generation
- WHEN approval is processed
- THEN the operation MUST become non-executable without credential substitution

### Requirement: At-most-once execution and recovery

Approval and rejection MUST be idempotent and single-use. Duplicate, rejected, expired, changed, completed, replayed, stale, or generation-mismatched attempts MUST NOT duplicate execution. Persisted state MUST preserve correctness across retries, restarts, and ambiguous Meta writes; an ambiguous write MUST NOT be retried unless endpoint idempotency or reconciliation proves safety.

#### Scenario: Approval replay

- GIVEN an operation already has a terminal execution result
- WHEN the approval command is replayed after restart
- THEN the existing result MUST be returned or reported without a second Meta mutation

#### Scenario: Ambiguous write outcome

- GIVEN dispatch may have reached Meta but no definitive result was recorded
- WHEN recovery runs
- THEN execution MUST pause for safe reconciliation rather than automatically repeat the write

### Requirement: Complete redacted Meta-call audit

Every Meta call, including reads, diagnostics, credential maintenance, preflight, and mutations, MUST append immutable audit metadata containing actor, resolved client and account, integration generation, logical operation, correlation ID, timestamp, normalized outcome or error, and redacted external evidence. Records MUST exclude tokens, secrets, authorization headers, and complete request or response bodies; mutation records MUST additionally link operation, approval decision, and execution outcome.

#### Scenario: Audited read failure

- GIVEN an authorized scoped read receives a Meta error
- WHEN the error is normalized
- THEN one append-only record MUST contain all required metadata and no prohibited secret or complete body

#### Scenario: Audited mutation

- GIVEN an owner-approved mutation completes or fails
- WHEN audit evidence is inspected
- THEN proposal, decision, Meta calls, and execution outcome MUST be separately recorded and linked
