# Technology decisions

The MVP is a small macOS-hosted Node.js service with an OpenAPI-first boundary. Prefer platform capabilities and narrow dependencies; add infrastructure only after a measured need.

## Chosen stack

| Layer | Decision | Reason |
|---|---|---|
| Runtime | Verified target Node.js `24.19.0`, npm `11.17.0`, with TypeScript | Exact Node is pinned by `.nvmrc`; native web APIs, test runner, and release-candidate SQLite keep dependencies narrow. |
| HTTP | Fastify | Structured logging, plugin/dependency injection, and socket-free `inject()` tests with low framework overhead. |
| Contract | `openapi-backend` | OpenAPI 3.1 routing plus JSON request validation and registered security handlers; responses require an explicit `postResponseHandler`. |
| Multipart | `@fastify/multipart` | Bound multipart ingestion while streaming to private disk; one bounded whole-file buffer is then used for content validation. |
| Persistence | `node:sqlite`, no ORM | Keep one local database and explicit prepared SQL. Enable WAL and foreign keys, manage migrations with `PRAGMA user_version`, and run protected, tested backups. |
| Exact arithmetic | `decimal.js` | Deterministic financial and pacing calculations with explicit rounding. |
| Media inspection | `file-type` | Sniff actual content before staging. Structural validation covers the supported formats; do not add `sharp` or `ffmpeg` initially. |
| Meta transport | Built-in `fetch`, `FormData`, `Blob`, and `AbortSignal` | Native HTTP and multipart support with explicit status and rate-limit headers and no transport dependency. |
| Platform services | `node:crypto`, `crypto.randomUUID`, `node:test`, macOS `security`/Keychain, and `launchd` | Native cryptography, identifiers, tests, secret storage, and process lifecycle. |
| OpenClaw | Installable `packages/openclaw-plugin`, compatible with host version `2026.9.2` through a peer dependency and focused public SDK imports | The OpenClaw host supplies the SDK; the service runtime does not depend on it. |

`node:sqlite` is a release candidate in Node 24, not yet stable. Its small dependency surface and built-in prepared statements/backups fit this local MVP, but compatibility and restore tests are mandatory. Use `better-sqlite3` only if a reproducible `node:sqlite` correctness, performance, or operability problem appears.

`.nvmrc` pins `24.19.0` for interactive development. `launchd` does not load shell profiles, and `nvm` is a shell function: LaunchAgent `ProgramArguments` must use a stable absolute Node 24 launcher or executable path, never `nvm`, `$NVM_BIN`, or an alias. The installer must resolve and update that stable path; a hardcoded developer home path is not a deployment strategy.

## Dependency boundary

| Class | Packages or facilities |
|---|---|
| Runtime | `fastify`, `openapi-backend`, `@fastify/multipart`, `decimal.js`, `file-type`; Node built-ins provide HTTP client, crypto, SQLite, and tests. |
| Host plugin peer | Exact compatible `openclaw@2026.9.2`; it is used to check/package the plugin and is not an application runtime dependency. |
| Development | `typescript`, `openapi-typescript`, `yaml`, `tsx`, `@types/node`. `yaml` is a direct parser dependency for generation, never a transitive assumption. |
| Native operating system | macOS `security` CLI/Keychain and `launchd`. |

Do not add Jest, Vitest, Supertest, dotenv, an ORM, Axios, the Meta SDK, Docker, Redis, PostgreSQL, or a job framework to the MVP.

## Fetch and MetaClient

Choose native `fetch` over Axios. Node already provides cancellation, multipart bodies, and direct access to response and rate-limit headers. Axios conveniences do not implement Meta error normalization, safe retries, asynchronous Insights, idempotency, or operation lifecycle; those concerns belong in one narrow `MetaClient`.

`MetaClient` owns:

- the fixed `/v26.0` base path, `Authorization: Bearer`, and `appsecret_proof` HMAC; POST proof is a native form field, while the required GET query proof is permitted only with complete URL-query redaction from logs and audit evidence;
- timeout and cancellation;
- bounded, `Retry-After`-aware retries for reads, `429`, and temporary failures;
- no automatic retry of an ambiguously dispatched Meta write; retry a write only when endpoint-level idempotency exists or reconciliation proves the first attempt did not commit;
- `Retry-After` and Meta usage-header capture;
- pagination and asynchronous Insights polling;
- normalized safe errors and redacted audit metadata.

As of 2026-08-18, the official `facebook-nodejs-business-sdk` npm release is `24.0.1` while its source identifies API/SDK `v26.0`. Re-check both sources before any dependency decision; do not use it until the published package matches the pinned contract and materially reduces the narrow client code.

## API discovery

`openapi.yaml` is the canonical machine contract. `openapi-backend` routes operations and validates JSON requests and security through registered handlers. Response validation is explicit in a `postResponseHandler`. `openapi-typescript` generates types only; a small project generator uses the direct `yaml` development dependency to emit static runtime enums and tool schemas into one TypeScript artifact.

For `/v1/media`, `openapi-backend` handles route, headers, and security. The `@fastify/multipart` handling explicitly validates multipart fields, byte limits, declared MIME, content sniffing with `file-type`, and complete stream consumption. The route retains no whole-file copy: upload bytes stream into private disk staging, then the staging service owns one bounded whole-file memory buffer for structural validation. Do not treat streamed multipart as a normally parsed body validated by `openapi-backend`.

The OpenClaw plugin registers a curated projection with concise TypeBox schemas rather than injecting the full contract into every prompt. Its model-visible tools are exactly `list_scopes`, `integration_status`, `get_capabilities`, `list_campaigns`, `query_insights`, `budget_summary`, `propose_operation`, and `get_operation`. Media staging is instead the deterministic same-message `/stage-ad-media <client_id> <ad_account_id>` inbound command. It runs in `inbound_claim`, requires OpenClaw authorization plus the configured single owner before file or HTTP access, uses only that event's one fresh staged attachment, and never stores a session-to-message bridge. `approve-ad` and `reject-ad` remain separate deterministic owner-only commands outside model dispatch.

Static options come from OpenAPI enums. Dynamic assets and currently usable options come from scoped `GET /v1/capabilities`; their opaque IDs and access are revalidated at proposal creation and execution.

Swagger UI is not an alternative contract. If useful, run a separate loopback-only development viewer of the same `openapi.yaml`; never mount it in production or embed a token. Configure `supportedSubmitMethods: []` and `persistAuthorization: false`. If reads are intentionally enabled, use only `supportedSubmitMethods: ["get", "head"]`, retain `persistAuthorization: false`, and require manual bearer entry. Do not add Swagger runtime packages to the MVP server solely for documentation.

## Rejected alternatives

| Alternative | Reason rejected for MVP |
|---|---|
| Axios or Meta SDK | Extra transport/SDK surface without solving Meta-specific retries, errors, async Insights, idempotency, or the pinned-version publication gap. |
| ORM or job framework | Explicit SQL and persisted operation states are smaller and easier to audit at this scale. |
| `better-sqlite3` | Fallback only; avoid a native dependency while `node:sqlite` passes required checks. |
| `sharp` or `ffmpeg` | Content sniffing and structural validation cover initial requirements; transformation is not required. |
| Docker, Redis, PostgreSQL | Unnecessary for one private local process and database. |
| Jest, Vitest, Supertest | `node:test` plus Fastify `inject()` covers the required test boundary. |
| Mounted Swagger UI | Adds production attack and dependency surface without changing the canonical OpenAPI file. |

## Version and update policy

- Keep `.nvmrc` at the verified Node `24.19.0` target and npm at `11.17.0`; pin exact direct dependency versions in the future lockfile and update deliberately.
- Keep Meta at `v26.0` until contract fixtures, permission behavior, reads, mutation validation, and one scoped pilot pass on the replacement version.
- Review the `node:sqlite` stability status on each Node update and keep the documented fallback conditional.
- Regenerate OpenAPI types plus the small runtime enum/tool-schema artifact and rerun request, explicit response, security, contract-reference, and pilot checks whenever `openapi.yaml` or contract tooling changes.
- Use only documented focused OpenClaw SDK imports compatible with the installed published `openclaw` version.

## Official references

- [Node.js 24 documentation](https://nodejs.org/docs/latest-v24.x/api/)
- [Node.js SQLite](https://nodejs.org/docs/latest-v24.x/api/sqlite.html)
- [Fastify documentation](https://fastify.dev/docs/latest/)
- [Fastify multipart](https://github.com/fastify/fastify-multipart)
- [OpenAPI Backend](https://github.com/openapistack/openapi-backend)
- [OpenAPI TypeScript](https://openapi-ts.dev/)
- [decimal.js](https://mikemcl.github.io/decimal.js/)
- [file-type](https://github.com/sindresorhus/file-type)
- [OpenClaw Plugin SDK overview](https://docs.openclaw.ai/plugins/sdk-overview)
- [Meta Business SDK for Node.js](https://github.com/facebook/facebook-nodejs-business-sdk)
- [OpenAPI Specification 3.1](https://spec.openapis.org/oas/v3.1.1.html)
- [Swagger UI configuration](https://swagger.io/docs/open-source-tools/swagger-ui/usage/configuration/)
- [Apple launchd](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html)
