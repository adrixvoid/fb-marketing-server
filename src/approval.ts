import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { FastifyRequest } from "fastify";
import type { Context, HandlerMap } from "openapi-backend";
import type { ContractResponse } from "./contract.js";
import type { components } from "./generated/openapi.js";
import { appendAudit, transaction } from "./db.js";
import type { SecretProvider } from "./secrets.js";
import { resolveScope } from "./scope.js";

type Operation = components["schemas"]["Operation"];
type Decision = "approved" | "rejected";
const OWNER_PATTERN = /^[A-Za-z0-9._-]{1,64}:[A-Za-z0-9._-]{1,128}$/;
const DEFAULT_FRESHNESS_SECONDS = 300;

export function validOwnerIdentity(value: string): boolean {
  return OWNER_PATTERN.test(value);
}

export class ApprovalError extends Error {
  auditRecorded = false;

  constructor(
    message: string,
    readonly status: 403 | 404 | 409 | 410,
    readonly code: "forbidden" | "not_found" | "client_account_mismatch" | "operation_stale" | "operation_already_resolved" | "operation_expired",
  ) {
    super(message);
  }
}

interface ProofInput {
  secret: string;
  ownerIdentity: string;
  decision: Decision;
  operationId: string;
  method: string;
  path: string;
  body: Uint8Array;
  issuedAt: Date;
  nonce: Uint8Array;
}

function strictBase64(value: string, bytes?: number): Buffer {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error("Invalid encoded secret");
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value || (bytes !== undefined && decoded.length !== bytes)) throw new Error("Invalid encoded secret");
  return decoded;
}

function bodyHash(body: Uint8Array): string {
  return createHash("sha256").update(body).digest("hex");
}

function proofMessage(input: Omit<ProofInput, "secret" | "issuedAt" | "nonce"> & { issuedAt: number; nonce: string }): string {
  return [
    "v1",
    input.method,
    input.path,
    input.decision,
    input.operationId,
    bodyHash(input.body),
    input.ownerIdentity,
    String(input.issuedAt),
    input.nonce,
  ].join("\n");
}

export function signOwnerProof(input: ProofInput): string {
  if (!OWNER_PATTERN.test(input.ownerIdentity) || input.method !== input.method.toUpperCase() || input.path.length === 0 || /[\r\n]/.test(input.path)) {
    throw new Error("Invalid proof binding");
  }
  const nonceBytes = Buffer.from(input.nonce);
  if (nonceBytes.length < 16 || nonceBytes.length > 32) throw new Error("Invalid proof nonce");
  const nonce = nonceBytes.toString("base64url");
  const issuedAt = Math.floor(input.issuedAt.getTime() / 1000);
  const owner = Buffer.from(input.ownerIdentity).toString("base64url");
  const signature = createHmac("sha256", strictBase64(input.secret, 32))
    .update(proofMessage({ ...input, issuedAt, nonce }))
    .digest("base64url");
  return `v1.${issuedAt}.${nonce}.${owner}.${signature}`;
}

interface ParsedProof {
  issuedAt: number;
  nonce: string;
  ownerIdentity: string;
  signature: Buffer;
}

function parseProof(value: string): ParsedProof {
  const [version, timestamp, nonce, encodedOwner, signature, extra] = value.split(".");
  if (
    version !== "v1" || extra !== undefined || !/^(0|[1-9][0-9]{0,11})$/.test(timestamp ?? "") ||
    !/^[A-Za-z0-9_-]{22,64}$/.test(nonce ?? "") || !/^[A-Za-z0-9_-]+$/.test(encodedOwner ?? "") ||
    !/^[A-Za-z0-9_-]{43}$/.test(signature ?? "")
  ) throw new ApprovalError("Owner proof is invalid", 403, "forbidden");
  const ownerBytes = Buffer.from(encodedOwner!, "base64url");
  if (ownerBytes.toString("base64url") !== encodedOwner) throw new ApprovalError("Owner proof is invalid", 403, "forbidden");
  const ownerIdentity = ownerBytes.toString("utf8");
  if (!OWNER_PATTERN.test(ownerIdentity)) throw new ApprovalError("Owner proof is invalid", 403, "forbidden");
  const nonceBytes = Buffer.from(nonce!, "base64url");
  const signatureBytes = Buffer.from(signature!, "base64url");
  if (
    nonceBytes.length < 16 || nonceBytes.length > 32 || nonceBytes.toString("base64url") !== nonce ||
    signatureBytes.length !== 32 || signatureBytes.toString("base64url") !== signature
  ) throw new ApprovalError("Owner proof is invalid", 403, "forbidden");
  return { issuedAt: Number(timestamp), nonce: nonce!, ownerIdentity, signature: signatureBytes };
}

interface StoredOperationRow {
  id: string;
  actor: string;
  client_id: string;
  ad_account_id: string;
  generation_id: string;
  operation_type: string;
  payload_json: string;
  payload_hash: string;
  status: Operation["status"];
  result_json: string | null;
  created_at: string;
  expires_at: string;
  decision_id: string | null;
  decision_value: Decision | null;
  decided_at: string | null;
  owner_identity: string | null;
}

const operationSql = `
  SELECT o.*, d.id AS decision_id, d.decision AS decision_value, d.decided_at, d.owner_identity
  FROM operations o LEFT JOIN approval_decisions d ON d.operation_id = o.id
  WHERE o.id = ?
`;

function storedOperation(db: DatabaseSync, operationId: string): Operation {
  const row = db.prepare(operationSql).get(operationId) as unknown as StoredOperationRow | undefined;
  if (row === undefined) throw new ApprovalError("Operation was not found", 404, "not_found");
  const scope = resolveScope(db, { clientId: row.client_id, adAccountId: row.ad_account_id });
  return {
    operation_id: row.id,
    type: row.operation_type,
    status: row.status,
    scope: {
      client_id: scope.clientId, client_name: scope.clientName,
      ad_account_id: scope.adAccountId, ad_account_name: scope.adAccountName,
      ...(scope.currency === undefined ? {} : { currency: scope.currency }),
      ...(scope.timezone === undefined ? {} : { timezone: scope.timezone }),
    },
    integration_generation: row.generation_id,
    payload_hash: row.payload_hash,
    payload: JSON.parse(row.payload_json),
    created_at: row.created_at,
    expires_at: row.expires_at,
    decision: row.decision_value === null ? null : { decision: row.decision_value, decided_at: row.decided_at!, owner_identity: row.owner_identity! },
    result: row.result_json === null ? null : JSON.parse(row.result_json),
  } as Operation;
}

interface ApprovalOptions {
  db: DatabaseSync;
  secrets: SecretProvider;
  ownerIdentity: string;
  revalidate(input: { actor: string; requestId: string; operationId: string }): Promise<Operation>;
  cleanupOperationMedia(operationId: string, status: "consumed" | "expired" | "invalid"): Promise<number>;
  now?: () => Date;
  freshnessSeconds?: number;
  proofSecretName?: string;
  testHooks?: { beforeDecisionCommit?: () => void };
}

interface DecideInput {
  actor: string;
  requestId: string;
  clientId: string;
  adAccountId: string;
  operationId: string;
  decision: Decision;
  method: string;
  path: string;
  body: Uint8Array;
  proof: string;
}

export function createApprovalService({
  db,
  secrets,
  ownerIdentity,
  revalidate,
  cleanupOperationMedia,
  now = () => new Date(),
  freshnessSeconds = DEFAULT_FRESHNESS_SECONDS,
  proofSecretName = "owner-proof-hmac-key",
  testHooks = {},
}: ApprovalOptions) {
  if (!validOwnerIdentity(ownerIdentity)) throw new Error("Exactly one channel-scoped owner identity is required");
  if (!Number.isSafeInteger(freshnessSeconds) || freshnessSeconds < 1 || freshnessSeconds > 900) throw new Error("Invalid proof freshness");

  async function verify(input: DecideInput): Promise<ParsedProof> {
    const parsed = parseProof(input.proof);
    const current = Math.floor(now().getTime() / 1000);
    if (parsed.ownerIdentity !== ownerIdentity || input.actor !== ownerIdentity || parsed.issuedAt > current || current - parsed.issuedAt > freshnessSeconds) {
      throw new ApprovalError("Owner proof is forbidden or expired", 403, "forbidden");
    }
    const secret = await secrets.get(proofSecretName);
    if (secret === undefined) throw new ApprovalError("Owner proof is unavailable", 403, "forbidden");
    let expected: Buffer;
    try {
      expected = createHmac("sha256", strictBase64(secret, 32)).update(proofMessage({
        ...input,
        ownerIdentity: parsed.ownerIdentity,
        issuedAt: parsed.issuedAt,
        nonce: parsed.nonce,
      })).digest();
    } catch {
      throw new ApprovalError("Owner proof is unavailable", 403, "forbidden");
    }
    if (parsed.signature.length !== expected.length || !timingSafeEqual(parsed.signature, expected)) {
      throw new ApprovalError("Owner proof signature is invalid", 403, "forbidden");
    }
    return parsed;
  }

  function linkedAudit(row: StoredOperationRow, input: DecideInput, outcome: "succeeded" | "failed", eventType: "decision" | "revalidation", errorCode?: string, decisionId?: string) {
    const auditId = appendAudit(db, {
      actor: input.actor,
      clientId: row.client_id,
      adAccountId: row.ad_account_id,
      generationId: row.generation_id,
      operation: input.decision === "approved" ? "approve_operation" : "reject_operation",
      correlationId: input.requestId,
      occurredAt: now().toISOString(),
      outcome,
      evidence: errorCode === undefined ? { externalRequestId: decisionId ?? row.id } : { errorCode },
    });
    db.prepare("INSERT INTO operation_audit_links (audit_id, operation_id, decision_id, event_type) VALUES (?, ?, ?, ?)")
      .run(auditId, row.id, decisionId ?? null, eventType);
  }

  async function decideInternal(input: DecideInput): Promise<Operation> {
    const proof = await verify(input);
    const consumedAt = now();
    let preliminary: { row: StoredOperationRow; outcome: "proceed" | "same" | "expired" | "resolved" | "scope" };
    try {
      preliminary = transaction(db, () => {
        const row = db.prepare(operationSql).get(input.operationId) as unknown as StoredOperationRow | undefined;
        if (row === undefined) throw new ApprovalError("Operation was not found", 404, "not_found");
        db.prepare(`INSERT INTO proof_nonces
          (nonce, owner_identity, operation_id, decision, body_hash, issued_at, consumed_at, correlation_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(proof.nonce, ownerIdentity, input.operationId, input.decision, bodyHash(input.body), proof.issuedAt, consumedAt.toISOString(), input.requestId);
        if (row.client_id !== input.clientId || row.ad_account_id !== input.adAccountId) return { row, outcome: "scope" };
        if (consumedAt.getTime() >= Date.parse(row.expires_at)) {
          if (row.status === "pending") db.prepare("UPDATE operations SET status = 'expired' WHERE id = ? AND status = 'pending'").run(row.id);
          linkedAudit(row, input, "failed", "revalidation", "operation_expired");
          return { row, outcome: "expired" };
        }
        if (row.decision_value !== null) {
          if (row.decision_value === input.decision) linkedAudit(row, input, "succeeded", "decision", undefined, row.decision_id!);
          return { row, outcome: row.decision_value === input.decision ? "same" : "resolved" };
        }
        if (row.status !== "pending") return { row, outcome: "resolved" };
        return { row, outcome: "proceed" };
      });
    } catch (error) {
      if (error instanceof ApprovalError) throw error;
      throw new ApprovalError("Owner proof nonce was already consumed", 409, "operation_already_resolved");
    }
    if (preliminary.outcome === "scope") throw new ApprovalError("Operation scope does not match", 409, "client_account_mismatch");
    if (preliminary.outcome === "expired") {
      await cleanupOperationMedia(input.operationId, "expired");
      const error = new ApprovalError("Operation has expired", 410, "operation_expired");
      error.auditRecorded = true;
      throw error;
    }
    if (preliminary.outcome === "resolved") throw new ApprovalError("Operation is already resolved", 409, "operation_already_resolved");
    if (preliminary.outcome === "same") {
      if (input.decision === "rejected") await cleanupOperationMedia(input.operationId, "consumed");
      return storedOperation(db, input.operationId);
    }

    if (input.decision === "approved") {
      try {
        await revalidate({ actor: input.actor, requestId: input.requestId, operationId: input.operationId });
      } catch {
        transaction(db, () => {
          db.prepare("UPDATE operations SET status = 'stale' WHERE id = ? AND status = 'pending'").run(input.operationId);
          linkedAudit(preliminary.row, input, "failed", "revalidation", "operation_stale");
        });
        await cleanupOperationMedia(input.operationId, "invalid");
        const error = new ApprovalError("Operation revalidation failed", 409, "operation_stale");
        error.auditRecorded = true;
        throw error;
      }
    }

    const decisionId = randomUUID();
    const decidedAt = now();
    transaction(db, () => {
      const current = db.prepare(operationSql).get(input.operationId) as unknown as StoredOperationRow;
      if (current.decision_value !== null) {
        if (current.decision_value !== input.decision) throw new ApprovalError("Operation is already resolved", 409, "operation_already_resolved");
        linkedAudit(current, input, "succeeded", "decision", undefined, current.decision_id!);
        return;
      }
      if (current.status !== "pending") throw new ApprovalError("Operation is already resolved", 409, "operation_already_resolved");
      db.prepare(`INSERT INTO approval_decisions
        (id, operation_id, payload_hash, decision, owner_identity, decided_at, nonce, correlation_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(decisionId, current.id, current.payload_hash, input.decision, ownerIdentity, decidedAt.toISOString(), proof.nonce, input.requestId);
      if (input.decision === "rejected") db.prepare("UPDATE operations SET status = 'rejected' WHERE id = ? AND status = 'pending'").run(current.id);
      linkedAudit(current, input, "succeeded", "decision", undefined, decisionId);
      testHooks.beforeDecisionCommit?.();
    });
    if (input.decision === "rejected") await cleanupOperationMedia(input.operationId, "consumed");
    return storedOperation(db, input.operationId);
  }

  function auditFailure(input: DecideInput, error: unknown): void {
    const row = db.prepare(operationSql).get(input.operationId) as unknown as StoredOperationRow | undefined;
    const event = {
      actor: OWNER_PATTERN.test(input.actor) ? input.actor : ownerIdentity,
      ...(row === undefined ? {} : { clientId: row.client_id, adAccountId: row.ad_account_id, generationId: row.generation_id }),
      operation: input.decision === "approved" ? "approve_operation" : "reject_operation",
      correlationId: input.requestId,
      occurredAt: now().toISOString(),
      outcome: "failed" as const,
      evidence: { errorCode: error instanceof ApprovalError ? error.code : "decision_failed" },
    };
    if (row === undefined) {
      appendAudit(db, event);
      return;
    }
    transaction(db, () => {
      const auditId = appendAudit(db, event);
      db.prepare("INSERT INTO operation_audit_links (audit_id, operation_id, event_type) VALUES (?, ?, 'revalidation')").run(auditId, row.id);
    });
  }

  async function decide(input: DecideInput): Promise<Operation> {
    try {
      return await decideInternal(input);
    } catch (error) {
      if (!(error instanceof ApprovalError) || !error.auditRecorded) auditFailure(input, error);
      throw error;
    }
  }

  return { decide };
}

type ApprovalService = ReturnType<typeof createApprovalService>;

function requestId(context: Context): string {
  const value = context.request.headers["x-request-id"];
  return typeof value === "string" && /^[A-Za-z0-9._:-]{8,128}$/.test(value) ? value : randomUUID();
}

function approvalProblem(context: Context, error: ApprovalError): ContractResponse {
  const id = requestId(context);
  return {
    statusCode: error.status,
    mediaType: "application/problem+json",
    headers: { "x-request-id": id },
    body: {
      type: `urn:fb-marketing-server:${error.code}`,
      title: error.status === 403 ? "Forbidden" : error.status === 404 ? "Not found" : error.status === 410 ? "Gone" : "Conflict",
      status: error.status,
      code: error.code,
      detail: error.message,
      request_id: id,
    },
  };
}

export function createApprovalHandlers(service: ApprovalService, actor: string): HandlerMap {
  const handler = (decision: Decision) => async (context: Context, request: FastifyRequest) => {
    const id = requestId(context);
    try {
      if (Number(request.headers["content-length"] ?? 0) !== 0) throw new ApprovalError("Owner command body must be empty", 403, "forbidden");
      const operation = await service.decide({
        actor,
        requestId: id,
        clientId: String(context.request.query.client_id ?? ""),
        adAccountId: String(context.request.query.ad_account_id ?? ""),
        operationId: String(context.request.params.operation_id ?? ""),
        decision,
        method: request.method,
        path: request.url,
        body: Buffer.alloc(0),
        proof: String(context.request.headers["x-openclaw-owner-command"] ?? ""),
      });
      return {
        statusCode: decision === "approved" ? 202 : 200,
        mediaType: "application/json",
        headers: { "x-request-id": id },
        body: { request_id: id, operation },
      } satisfies ContractResponse;
    } catch (error) {
      if (error instanceof ApprovalError) return approvalProblem(context, error);
      throw error;
    }
  };
  return { approveOperation: handler("approved"), rejectOperation: handler("rejected") };
}
