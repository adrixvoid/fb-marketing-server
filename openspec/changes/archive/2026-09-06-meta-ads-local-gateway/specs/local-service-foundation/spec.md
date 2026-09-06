# Local Service Foundation Specification

## Purpose

Define the private service boundary, contract enforcement, durable local state, secret protection, and macOS operation. (SEC-1–4; NFR-1, NFR-6–7, NFR-12)

## Requirements

### Requirement: Loopback authenticated contract

The service MUST bind only to `127.0.0.1`, MUST accept only authenticated OpenClaw requests, and MUST validate requests and responses against `openapi.yaml`.

#### Scenario: Authenticated local request

- GIVEN the service is listening on `127.0.0.1`
- WHEN OpenClaw sends a contract-valid request with the dedicated credential
- THEN the service MUST route it according to the OpenAPI operation

#### Scenario: Untrusted request

- GIVEN a request is non-loopback or has a missing or invalid credential
- WHEN it reaches the service boundary
- THEN the service MUST reject it before protected state or Meta is accessed

### Requirement: Secret confinement

The service MUST keep Meta tokens, App Secrets, service credentials, encryption keys, and authorization headers out of responses, logs, audits, prompts, tool context, traces, chat, and source control. Meta credentials MUST be encrypted at rest with a key held separately in macOS Keychain.

#### Scenario: Canary confinement

- GIVEN unique canaries for every secret class
- WHEN success, failure, diagnostic, proposal, approval, and audit paths run
- THEN exact-match scans of every output surface MUST find no canary

#### Scenario: Persisted credentials

- GIVEN stored credential records and the SQLite database
- WHEN an operator inspects persistence
- THEN only ciphertext or protected references MUST appear and the encryption key MUST be absent

### Requirement: Durable local persistence

SQLite MUST use WAL mode, foreign keys, and transactions for multi-record state transitions. Backups MUST receive live-data protection and have a tested restore that remains locally operable without Docker, PostgreSQL, or a dashboard.

#### Scenario: Transaction interruption

- GIVEN a multi-record lifecycle transition
- WHEN the process stops before commit
- THEN recovery MUST expose either the prior state or the complete committed state, never a partial transition

#### Scenario: Protected restore

- GIVEN a protected backup
- WHEN the documented restore check runs
- THEN mappings, immutable history, and operational state MUST reload locally

### Requirement: Per-user macOS operation

A per-user LaunchAgent MUST start the service at login, and redacted application logs MUST be written under `~/Library/Logs/fb-marketing-server/`.

#### Scenario: Login startup

- GIVEN an installed per-user LaunchAgent
- WHEN the user logs in
- THEN the loopback service MUST start and write only redacted logs at the required location
