# OpenClaw Tooling Specification

## Purpose

Define the model-visible read/propose tools and the separate deterministic owner command boundary.

## Requirements

### Requirement: Curated model-visible tools

The OpenClaw plugin MUST expose only `list_scopes`, `integration_status`, `get_capabilities`, `list_campaigns`, `query_insights`, `budget_summary`, `upload_chat_media`, `propose_operation`, and `get_operation` to model dispatch. Tool schemas MUST be a concise projection of the canonical API and MUST NOT expose arbitrary Graph forwarding, credentials, approval, or rejection.

#### Scenario: Tool registration

- GIVEN the plugin loads against a supported public OpenClaw SDK
- WHEN model-visible tools are enumerated
- THEN the set MUST equal the curated list and contain no approve or reject tool

#### Scenario: Tool output

- GIVEN any tool succeeds or fails
- WHEN its result enters model context
- THEN it MUST preserve required scope and remediation data without secrets or authorization material

### Requirement: Read and proposal authority separation

Read tools MUST execute after authorization and required scope resolution without human approval. Proposal tools MAY create immutable pending operations but MUST NOT approve, reject, or execute them.

#### Scenario: Authorized read tool

- GIVEN an authorized explicit scope
- WHEN a reporting tool is invoked
- THEN it MUST return the scoped result without creating an approval decision

#### Scenario: Proposal tool

- GIVEN a valid typed mutation request
- WHEN `propose_operation` is invoked
- THEN it MUST return a pending operation and MUST NOT execute it

### Requirement: Trusted attachment tool boundary

`upload_chat_media` MUST obtain bytes and metadata only from host-trusted inbound attachment context supplied by the supported public SDK. Its model schema MUST NOT accept local paths or remote URLs, and it MUST fail closed when trusted context is absent.

#### Scenario: Missing host attachment

- GIVEN model input names media but host-trusted bytes are absent
- WHEN `upload_chat_media` runs
- THEN it MUST fail without staging media or calling Meta

### Requirement: Deterministic owner commands

`/approve-ad <operation_id>` and `/reject-ad <operation_id>` MUST run outside model dispatch, require an authorized sender who is the configured channel-scoped owner, and call the loopback service with protected proof unavailable to the model. Natural-language agreement MUST NOT invoke either command.

#### Scenario: Owner command

- GIVEN the configured owner invokes `/approve-ad` through the deterministic command path
- WHEN sender authorization succeeds
- THEN the plugin MUST submit the bound decision outside model dispatch

#### Scenario: Unauthorized command

- GIVEN any other sender or model-generated request
- WHEN approval or rejection is attempted
- THEN the plugin MUST reject it without exposing owner proof or changing operation state

### Requirement: Independent global composition

OpenClaw MAY build a global operational budget table only by paging authorized scopes and requesting one pacing result per pair. It MUST NOT request an unscoped Meta report, rank clients, compare accounts, or aggregate currencies.

#### Scenario: Global budget table

- GIVEN multiple authorized client and Ad Account pairs
- WHEN the table is composed
- THEN each row MUST retain its client/account identity and independent currency result
