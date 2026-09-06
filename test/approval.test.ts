import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect } from "node:net";
import test, { type TestContext } from "node:test";
import { ApprovalError, createApprovalHandlers, createApprovalService, signOwnerProof } from "../src/approval.js";
import { buildApp } from "../src/app.js";
import { openDatabase } from "../src/db.js";
import { createMediaService } from "../src/media.js";
import { OperationError, createOperationsService } from "../src/operations.js";
import { MetaError } from "../src/meta-client.js";
import type { SecretProvider } from "../src/secrets.js";

const now = new Date("2026-08-19T12:00:00.000Z");
const owner = "discord:user-1";
const proofSecret = Buffer.alloc(32, 9).toString("base64");
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

class FakeSecrets implements SecretProvider {
  readonly values = new Map([["owner-proof-hmac-key", proofSecret]]);
  gets = 0;
  constructor(private readonly beforeGet?: () => void) {}
  async get(name: string) { this.gets += 1; this.beforeGet?.(); return this.values.get(name); }
  async create(name: string, value: string) {
    if (this.values.has(name)) return false;
    this.values.set(name, value);
    return true;
  }
}

function seed(db: ReturnType<typeof openDatabase>) {
  db.exec(`
    INSERT INTO clients (id, name, portfolio_id) VALUES ('client-1', 'Client One', 'portfolio-1');
    INSERT INTO integrations (id, name, meta_app_id, state) VALUES ('integration-1', 'App', 'app-1', 'active');
    INSERT INTO integration_generations (id, integration_id, generation, status, validated_at)
      VALUES ('generation-1', 'integration-1', '2026-08', 'active', '${now.toISOString()}');
    INSERT INTO ad_accounts (id, client_id, name, currency, timezone)
      VALUES ('act_1', 'client-1', 'Account One', 'USD', 'America/New_York');
    INSERT INTO scope_mappings
      (client_id, ad_account_id, generation_id, active, app_authorized, subject_authorized, partner_authorized, asset_authorized, granted_tasks)
      VALUES ('client-1', 'act_1', 'generation-1', 1, 1, 1, 1, 1, '["ADVERTISE"]');
    INSERT INTO encrypted_credentials
      (id, generation_id, subject_id, key_ref, envelope_version, ciphertext, iv, auth_tag, scopes, status, validated_at)
      VALUES ('credential-1', 'generation-1', 'subject-1', 'key', 1, 'cipher', 'iv', 'tag',
        '["ads_read","ads_management","pages_read_engagement","leads_retrieval","instagram_basic"]', 'active', '${now.toISOString()}');
  `);
}

async function fixture(t: TestContext, options: {
  campaign?: boolean;
  failRevalidation?: boolean;
  revalidationError?: Error;
  crossExpiryDuringRevalidation?: boolean;
  rotateGenerationDuringTarget?: boolean;
  rotateGenerationAfterRevalidation?: boolean;
  crossProofExpiryDuringSecretLookup?: boolean;
  targetOperation?: boolean;
  failMediaDelete?: boolean;
  beforeDecisionCommit?: () => void;
  rateLimit?: { windowSeconds: number; globalLimit: number; ownerLimit: number };
  executeApproved?: (input: { operationId: string; actor: string; requestId: string }) => Promise<any>;
} = {}) {
  const root = await mkdtemp(join(tmpdir(), "fb-marketing-server-approval-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const db = openDatabase(":memory:");
  t.after(() => db.close());
  seed(db);
  const mediaRoot = join(root, "media");
  const media = await createMediaService({
    db, dataRoot: root, mediaRoot, now: () => now,
    ...(options.failMediaDelete ? { removeFile: async () => { throw new Error("simulated delete failure"); } } : {}),
  });
  let staged: Awaited<ReturnType<Awaited<ReturnType<typeof createMediaService>>["stage"]>> | undefined;
  if (options.campaign) {
    staged = await media.stage({
      actor: "openclaw:user-1", requestId: "request-stage-approval", clientId: "client-1", adAccountId: "act_1",
      attachment: { source: "openclaw_chat_attachment", attachment_id: "attachment-approval", original_filename: "creative.png", declared_content_type: "image/png" },
      declaredFileType: "image/png", bytes: (async function* () { yield png; })(),
    });
  }
  let current = now;
  let targetChecks = 0;
  let generationRotated = false;
  const rotateGeneration = () => {
    if (generationRotated) return;
    generationRotated = true;
    db.exec(`
      INSERT INTO integration_generations (id, integration_id, generation, status, validated_at)
        VALUES ('generation-2', 'integration-1', '2026-09', 'active', '${now.toISOString()}');
      INSERT INTO encrypted_credentials
        (id, generation_id, subject_id, key_ref, envelope_version, ciphertext, iv, auth_tag, scopes, status, validated_at)
        VALUES ('credential-2', 'generation-2', 'subject-1', 'key', 1, 'cipher', 'iv', 'tag',
          '["ads_read","ads_management","pages_read_engagement","leads_retrieval","instagram_basic"]', 'active', '${now.toISOString()}');
      UPDATE scope_mappings SET active = 0 WHERE client_id = 'client-1' AND ad_account_id = 'act_1';
      INSERT INTO scope_mappings
        (client_id, ad_account_id, generation_id, active, app_authorized, subject_authorized, partner_authorized, asset_authorized, granted_tasks)
        VALUES ('client-1', 'act_1', 'generation-2', 1, 1, 1, 1, 1, '["ADVERTISE"]');
    `);
  };
  const operations = createOperationsService({
    db,
    hashMediaFile: media.hashFile,
    now: () => current,
    capabilities: async () => ({
      assets: [{ asset_type: "page", page_id: "page-1", name: "Page" }, { asset_type: "pixel", pixel_id: "pixel-1", name: "Pixel" }],
      capabilities: { sales_website: { status: "available" }, leads_website: { status: "available" }, leads_instant_form: { status: "available" } },
    }),
    validateTarget: async (input) => {
      targetChecks += 1;
      if (options.rotateGenerationDuringTarget && targetChecks === 2) rotateGeneration();
      return input.objectId;
    },
  });
  const proposal = await operations.propose({
    actor: "openclaw:user-1",
    requestId: "request-proposal-approval",
    idempotencyKey: "idempotency-approval-1",
    request: options.campaign
      ? {
          type: "create_campaign_bundle", client_id: "client-1", ad_account_id: "act_1",
          payload: {
            campaign_kind: "SALES_WEBSITE",
            campaign: { name: "Sales", budget: { kind: "daily", value: { amount: "10.00", currency: "USD" } } },
            ad_set: { name: "Set", pixel_id: "pixel-1", targeting: { countries: ["US"], minimum_age: 21, maximum_age: 55 } },
            creative: { name: "Creative", page_id: "page-1", message: "Buy", website_url: "https://example.com", call_to_action: "SHOP_NOW", media: [{ media_id: staged!.media.media_id, sha256: staged!.media.sha256 }] },
            ad: { name: "Ad" },
          },
        }
      : options.targetOperation
        ? { type: "update_object", client_id: "client-1", ad_account_id: "act_1", payload: { object_type: "campaign", object_id: "campaign-1", changes: { name: "Renamed" } } }
        : { type: "configure_monthly_budget", client_id: "client-1", ad_account_id: "act_1", payload: { monthly_budget: { amount: "100.00", currency: "USD" } } },
  });
  const secrets = new FakeSecrets(options.crossProofExpiryDuringSecretLookup ? () => { current = new Date(now.getTime() + 1_000); } : undefined);
  const approval = createApprovalService({
    db,
    secrets,
    ownerIdentity: owner,
    now: () => current,
    revalidate: options.revalidationError
      ? async () => { throw options.revalidationError; }
      : options.failRevalidation
      ? async () => { throw new OperationError("stale", 409, "operation_stale"); }
      : options.crossExpiryDuringRevalidation
        ? async (input) => { const result = await operations.revalidate(input); current = new Date(proposal.operation.expires_at); return result; }
        : options.rotateGenerationAfterRevalidation
          ? async (input) => { const result = await operations.revalidate(input); rotateGeneration(); return result; }
          : operations.revalidate,
    cleanupOperationMedia: media.cleanupOperation,
    ...(options.executeApproved === undefined ? {} : { executeApproved: options.executeApproved }),
    ...(options.beforeDecisionCommit === undefined ? {} : { testHooks: { beforeDecisionCommit: options.beforeDecisionCommit } }),
    ...(options.rateLimit === undefined ? {} : { rateLimit: options.rateLimit }),
  });
  return { root, db, approval, operations, proposal, secrets, staged, mediaRoot, setNow: (value: Date) => { current = value; } };
}

function proofFor(operationId: string, decision: "approved" | "rejected", nonce: number, issuedAt = now, overrides: Partial<Parameters<typeof signOwnerProof>[0]> = {}) {
  const path = `/v1/operations/${operationId}/${decision === "approved" ? "approve" : "reject"}?client_id=client-1&ad_account_id=act_1`;
  return {
    path,
    proof: signOwnerProof({
      secret: proofSecret, ownerIdentity: owner, decision, operationId, method: "POST", path,
      body: Buffer.alloc(0), issuedAt, nonce: Buffer.alloc(16, nonce), ...overrides,
    }),
  };
}

async function rawHttp(app: Awaited<ReturnType<typeof buildApp>>, request: string): Promise<{ status: number; headers: Record<string, string>; body: unknown }> {
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  if (address === null || typeof address === "string") throw new Error("Test server did not bind TCP");
  const response = await new Promise<string>((resolve, reject) => {
    const socket = connect(address.port, "127.0.0.1");
    let data = "";
    socket.setEncoding("utf8");
    socket.on("connect", () => socket.end(request));
    socket.on("data", (chunk) => { data += chunk; });
    socket.on("end", () => resolve(data));
    socket.on("error", reject);
  });
  const [head, rawBody = ""] = response.split("\r\n\r\n", 2);
  const lines = head!.split("\r\n");
  const status = Number(lines[0]!.split(" ")[1]);
  const headers = Object.fromEntries(lines.slice(1).map((line) => {
    const separator = line.indexOf(":");
    return [line.slice(0, separator).toLowerCase(), line.slice(separator + 1).trim()];
  }));
  return { status, headers, body: rawBody === "" ? undefined : JSON.parse(rawBody) };
}

test("accepts one fresh owner-bound approval proof and records an immutable linked decision without executing", async (t) => {
  const { db, approval, proposal } = await fixture(t);
  const operationId = proposal.operation.operation_id;
  const path = `/v1/operations/${operationId}/approve?client_id=client-1&ad_account_id=act_1`;
  const proof = signOwnerProof({
    secret: proofSecret,
    ownerIdentity: owner,
    decision: "approved",
    operationId,
    method: "POST",
    path,
    body: Buffer.alloc(0),
    issuedAt: now,
    nonce: Buffer.alloc(16, 1),
  });
  const operation = await approval.decide({
    actor: owner,
    requestId: "request-approve-1",
    clientId: "client-1",
    adAccountId: "act_1",
    operationId,
    decision: "approved",
    method: "POST",
    path,
    body: Buffer.alloc(0),
    proof,
  });

  assert.equal(operation.status, "pending");
  assert.deepEqual(operation.decision, { decision: "approved", decided_at: now.toISOString(), owner_identity: owner });
  assert.equal(db.prepare("SELECT count(*) AS count FROM approval_decisions").get()!.count, 1);
  assert.equal(db.prepare("SELECT count(*) AS count FROM proof_nonces").get()!.count, 1);
  assert.equal(db.prepare("SELECT count(*) AS count FROM operation_audit_links WHERE decision_id IS NOT NULL").get()!.count, 1);
  assert.equal(db.prepare("SELECT status FROM operations WHERE id = ?").get(operationId)!.status, "pending");
  assert.throws(() => db.prepare("UPDATE approval_decisions SET decision = 'rejected'").run(), /immutable/);
  assert.throws(() => db.prepare("UPDATE proof_nonces SET owner_identity = 'discord:other'").run(), /immutable/);
  assert.throws(() => db.prepare("DELETE FROM operation_audit_links").run(), /immutable/);
  assert.doesNotMatch(JSON.stringify(db.prepare("SELECT * FROM audit_log").all()), new RegExp(proof.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(JSON.stringify(db.prepare("SELECT * FROM proof_nonces").all()), new RegExp(proofSecret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("executes after the immutable approved decision and returns a terminal result", async (t) => {
  let executions = 0;
  let value!: Awaited<ReturnType<typeof fixture>>;
  value = await fixture(t, {
    executeApproved: async ({ operationId, actor, requestId }) => {
      executions += 1;
      const operation = value.operations.get({ actor, requestId, clientId: "client-1", adAccountId: "act_1", operationId });
      return { ...operation, status: "succeeded", result: { status: "succeeded", completed_at: now.toISOString() } };
    },
  });
  const operationId = value.proposal.operation.operation_id;
  const signed = proofFor(operationId, "approved", 46);

  const result = await value.approval.decide({
    actor: owner, requestId: "request-execute-after-approval", clientId: "client-1", adAccountId: "act_1",
    operationId, decision: "approved", method: "POST", path: signed.path, body: Buffer.alloc(0), proof: signed.proof,
  });

  assert.equal(executions, 1);
  assert.equal(result.status, "succeeded");
  assert.equal(value.db.prepare("SELECT count(*) AS count FROM approval_decisions").get()!.count, 1);
});

test("reports execution-time staleness as an operation lifecycle conflict", async (t) => {
  let value!: Awaited<ReturnType<typeof fixture>>;
  value = await fixture(t, {
    executeApproved: async ({ operationId, actor, requestId }) => ({
      ...value.operations.get({ actor, requestId, clientId: "client-1", adAccountId: "act_1", operationId }),
      status: "stale", result: null,
    }),
  });
  const operationId = value.proposal.operation.operation_id;
  const signed = proofFor(operationId, "approved", 47);
  await assert.rejects(
    value.approval.decide({
      actor: owner, requestId: "request-stale-execution", clientId: "client-1", adAccountId: "act_1",
      operationId, decision: "approved", method: "POST", path: signed.path, body: Buffer.alloc(0), proof: signed.proof,
    }),
    (error: unknown) => error instanceof ApprovalError && error.status === 409 && error.code === "operation_stale",
  );
  assert.equal(value.db.prepare("SELECT count(*) AS count FROM approval_decisions").get()!.count, 1);
});

test("approval preserves retryable revalidation status without marking the proposal stale", async (t) => {
  for (const [name, upstream, expectedStatus, expectedCode, retryAfter] of [
    ["rate-limit", new MetaError("limited", "meta_4", 400, 17, true), 429, "rate_limited", "17"],
    ["upstream", new MetaError("unavailable", "upstream_error", 503, undefined, true), 502, "meta_error", undefined],
  ] as const) {
    const value = await fixture(t, { revalidationError: upstream });
    const operationId = value.proposal.operation.operation_id;
    const signed = proofFor(operationId, "approved", expectedStatus === 429 ? 50 : 51);
    const app = await buildApp({ serviceToken: "service-token", handlers: createApprovalHandlers(value.approval, owner) });
    t.after(() => app.close());
    const response = await app.inject({ method: "POST", url: signed.path, headers: {
      authorization: "Bearer service-token", "x-openclaw-owner-command": signed.proof, "x-request-id": `request-${name}`,
    } });

    assert.equal(response.statusCode, expectedStatus, name);
    assert.equal(response.json().code, expectedCode, name);
    assert.equal(response.headers["retry-after"], retryAfter, name);
    assert.equal(value.db.prepare("SELECT status FROM operations WHERE id = ?").get(operationId)!.status, "pending", name);
    assert.equal(value.db.prepare("SELECT count(*) AS count FROM approval_decisions WHERE operation_id = ?").get(operationId)!.count, 0, name);
  }
});

test("approval normalizes a post-decision pre-write revalidation failure for retry", async (t) => {
  const value = await fixture(t, {
    executeApproved: async () => { throw new MetaError("limited", "meta_17", 400, 11, true); },
  });
  const operationId = value.proposal.operation.operation_id;
  const signed = proofFor(operationId, "approved", 52);
  const app = await buildApp({ serviceToken: "service-token", handlers: createApprovalHandlers(value.approval, owner) });
  t.after(() => app.close());

  const response = await app.inject({ method: "POST", url: signed.path, headers: {
    authorization: "Bearer service-token", "x-openclaw-owner-command": signed.proof, "x-request-id": "request-execution-revalidation",
  } });

  assert.equal(response.statusCode, 429);
  assert.equal(response.json().code, "rate_limited");
  assert.equal(response.headers["retry-after"], "11");
  assert.equal(value.db.prepare("SELECT status FROM operations WHERE id = ?").get(operationId)!.status, "pending");
  assert.equal(value.db.prepare("SELECT count(*) AS count FROM approval_decisions WHERE operation_id = ?").get(operationId)!.count, 1);
});

test("owner route returns correlated lifecycle next actions for stale execution", async (t) => {
  let value!: Awaited<ReturnType<typeof fixture>>;
  value = await fixture(t, {
    executeApproved: async ({ operationId, actor, requestId }) => ({
      ...value.operations.get({ actor, requestId, clientId: "client-1", adAccountId: "act_1", operationId }),
      status: "stale", result: null, next_action: "retry_new_operation",
    } as never),
  });
  const operationId = value.proposal.operation.operation_id;
  const signed = proofFor(operationId, "approved", 49);
  const app = await buildApp({ serviceToken: "service-token", handlers: createApprovalHandlers(value.approval, owner) });
  t.after(() => app.close());
  const response = await app.inject({
    method: "POST", url: signed.path,
    headers: { authorization: "Bearer service-token", "x-request-id": "request-stale-next-action", "x-openclaw-owner-command": signed.proof },
  });

  assert.equal(response.statusCode, 409);
  assert.equal(response.headers["x-request-id"], "request-stale-next-action");
  assert.equal(response.json().code, "operation_stale");
  assert.equal(response.json().next_action, "retry_new_operation");
});

test("reports an execution-time expiry at the exact boundary as gone", async (t) => {
  let value!: Awaited<ReturnType<typeof fixture>>;
  value = await fixture(t, {
    executeApproved: async ({ operationId, actor, requestId }) => ({
      ...value.operations.get({ actor, requestId, clientId: "client-1", adAccountId: "act_1", operationId }),
      status: "expired", result: null,
    }),
  });
  const operationId = value.proposal.operation.operation_id;
  const signed = proofFor(operationId, "approved", 48);
  await assert.rejects(
    value.approval.decide({
      actor: owner, requestId: "request-expired-execution", clientId: "client-1", adAccountId: "act_1",
      operationId, decision: "approved", method: "POST", path: signed.path, body: Buffer.alloc(0), proof: signed.proof,
    }),
    (error: unknown) => error instanceof ApprovalError && error.status === 410 && error.code === "operation_expired",
  );
});

test("rejects wrong owner, channel, freshness, method, path, body, secret, and malformed proofs before nonce persistence", async (t) => {
  const { db, approval, proposal } = await fixture(t);
  const operationId = proposal.operation.operation_id;
  const valid = proofFor(operationId, "approved", 2);
  const [version, timestamp, canonicalNonce, encodedOwner] = valid.proof.split(".");
  const noncanonicalNonce = `${canonicalNonce!.slice(0, -1)}${canonicalNonce!.endsWith("Q") ? "R" : "B"}`;
  const noncanonicalMessage = [version, "POST", valid.path, "approved", operationId, createHash("sha256").update(Buffer.alloc(0)).digest("hex"), owner, timestamp, noncanonicalNonce].join("\n");
  const noncanonicalProof = `${version}.${timestamp}.${noncanonicalNonce}.${encodedOwner}.${createHmac("sha256", Buffer.from(proofSecret, "base64")).update(noncanonicalMessage).digest("base64url")}`;
  const attempts = [
    { actor: "discord:user-2", proof: valid.proof, path: valid.path, method: "POST", body: Buffer.alloc(0) },
    { actor: owner, ...proofFor(operationId, "approved", 3, new Date(now.getTime() - 301_000)), method: "POST", body: Buffer.alloc(0) },
    { actor: owner, ...proofFor(operationId, "approved", 4, new Date(now.getTime() + 1_000)), method: "POST", body: Buffer.alloc(0) },
    { actor: owner, proof: valid.proof, path: valid.path, method: "PUT", body: Buffer.alloc(0) },
    { actor: owner, proof: valid.proof, path: `${valid.path}&changed=1`, method: "POST", body: Buffer.alloc(0) },
    { actor: owner, proof: valid.proof, path: valid.path, method: "POST", body: Buffer.from("changed") },
    { actor: owner, path: valid.path, method: "POST", body: Buffer.alloc(0), proof: signOwnerProof({ secret: Buffer.alloc(32, 8).toString("base64"), ownerIdentity: owner, decision: "approved", operationId, method: "POST", path: valid.path, body: Buffer.alloc(0), issuedAt: now, nonce: Buffer.alloc(16, 5) }) },
    { actor: owner, path: valid.path, method: "POST", body: Buffer.alloc(0), proof: "model-supplied-consent" },
    { actor: owner, path: valid.path, method: "POST", body: Buffer.alloc(0), proof: noncanonicalProof },
  ];
  for (const attempt of attempts) {
    await assert.rejects(
      approval.decide({ requestId: "request-invalid-proof", clientId: "client-1", adAccountId: "act_1", operationId, decision: "approved", ...attempt }),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "forbidden",
    );
  }
  assert.equal(db.prepare("SELECT count(*) AS count FROM proof_nonces").get()!.count, 0);
  assert.equal(db.prepare("SELECT count(*) AS count FROM approval_decisions").get()!.count, 0);
  assert.equal(db.prepare("SELECT count(*) AS count FROM audit_log WHERE logical_operation = 'approve_operation' AND outcome = 'failed'").get()!.count, attempts.length);
  assert.equal(db.prepare("SELECT count(*) AS count FROM operation_audit_links WHERE event_type = 'revalidation'").get()!.count, attempts.length);
  assert.doesNotMatch(JSON.stringify(db.prepare("SELECT evidence FROM audit_log").all()), /model-supplied-consent|owner-proof-hmac-key/);
});

test("records rejection once, returns identical decisions idempotently, and rejects the opposite decision", async (t) => {
  const { db, approval, proposal } = await fixture(t);
  const operationId = proposal.operation.operation_id;
  const first = proofFor(operationId, "rejected", 6);
  const rejected = await approval.decide({ actor: owner, requestId: "request-reject-1", clientId: "client-1", adAccountId: "act_1", operationId, decision: "rejected", method: "POST", path: first.path, body: Buffer.alloc(0), proof: first.proof });
  const duplicate = proofFor(operationId, "rejected", 7);
  const replayed = await approval.decide({ actor: owner, requestId: "request-reject-2", clientId: "client-1", adAccountId: "act_1", operationId, decision: "rejected", method: "POST", path: duplicate.path, body: Buffer.alloc(0), proof: duplicate.proof });
  assert.equal(rejected.status, "rejected");
  assert.equal(replayed.status, "rejected");
  assert.throws(() => db.prepare("UPDATE operations SET status = 'pending'").run(), /transition/i);
  assert.equal(db.prepare("SELECT count(*) AS count FROM approval_decisions").get()!.count, 1);
  assert.equal(db.prepare("SELECT count(*) AS count FROM proof_nonces").get()!.count, 2);
  assert.equal(db.prepare("SELECT count(*) AS count FROM audit_log WHERE logical_operation = 'reject_operation' AND outcome = 'succeeded'").get()!.count, 2);
  assert.equal(db.prepare("SELECT count(*) AS count FROM operation_audit_links WHERE decision_id IS NOT NULL").get()!.count, 2);

  const opposite = proofFor(operationId, "approved", 8);
  await assert.rejects(
    approval.decide({ actor: owner, requestId: "request-opposite", clientId: "client-1", adAccountId: "act_1", operationId, decision: "approved", method: "POST", path: opposite.path, body: Buffer.alloc(0), proof: opposite.proof }),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "operation_already_resolved",
  );
});

test("removes bound media when its operation is rejected", async (t) => {
  const value = await fixture(t, { campaign: true });
  const operationId = value.proposal.operation.operation_id;
  const row = value.db.prepare("SELECT storage_name FROM staged_media WHERE id = ?").get(value.staged!.media.media_id)!;
  const rejection = proofFor(operationId, "rejected", 17);
  await value.approval.decide({ actor: owner, requestId: "request-reject-media", clientId: "client-1", adAccountId: "act_1", operationId, decision: "rejected", method: "POST", path: rejection.path, body: Buffer.alloc(0), proof: rejection.proof });
  assert.equal(value.db.prepare("SELECT status FROM staged_media WHERE id = ?").get(value.staged!.media.media_id)!.status, "consumed");
  await assert.rejects(stat(join(value.mediaRoot, String(row.storage_name))));
});

test("consumes proof nonces across restart and concurrent decisions without duplicate decision records", async (t) => {
  const value = await fixture(t);
  const operationId = value.proposal.operation.operation_id;
  const first = proofFor(operationId, "approved", 9);
  const second = proofFor(operationId, "approved", 10);
  const decisions = await Promise.all([
    value.approval.decide({ actor: owner, requestId: "request-concurrent-a", clientId: "client-1", adAccountId: "act_1", operationId, decision: "approved", method: "POST", path: first.path, body: Buffer.alloc(0), proof: first.proof }),
    value.approval.decide({ actor: owner, requestId: "request-concurrent-b", clientId: "client-1", adAccountId: "act_1", operationId, decision: "approved", method: "POST", path: second.path, body: Buffer.alloc(0), proof: second.proof }),
  ]);
  assert.deepEqual(decisions.map(({ decision }) => decision?.decision), ["approved", "approved"]);
  assert.equal(value.db.prepare("SELECT count(*) AS count FROM approval_decisions").get()!.count, 1);
  assert.equal(value.db.prepare("SELECT count(*) AS count FROM proof_nonces").get()!.count, 2);

  const restarted = createApprovalService({ db: value.db, secrets: value.secrets, ownerIdentity: owner, now: () => now, revalidate: value.operations.revalidate, cleanupOperationMedia: async () => 0 });
  await assert.rejects(
    restarted.decide({ actor: owner, requestId: "request-replay-restart", clientId: "client-1", adAccountId: "act_1", operationId, decision: "approved", method: "POST", path: first.path, body: Buffer.alloc(0), proof: first.proof }),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "operation_already_resolved",
  );
});

test("expires operations at exact equality and marks changed authority or media stale before approval", async (t) => {
  const expired = await fixture(t);
  const operationId = expired.proposal.operation.operation_id;
  const boundary = new Date(expired.proposal.operation.expires_at);
  expired.setNow(boundary);
  const atBoundary = proofFor(operationId, "approved", 11, boundary);
  await assert.rejects(
    expired.approval.decide({ actor: owner, requestId: "request-expired", clientId: "client-1", adAccountId: "act_1", operationId, decision: "approved", method: "POST", path: atBoundary.path, body: Buffer.alloc(0), proof: atBoundary.proof }),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "operation_expired",
  );
  assert.equal(expired.db.prepare("SELECT status FROM operations WHERE id = ?").get(operationId)!.status, "expired");

  const generation = await fixture(t);
  generation.db.prepare("UPDATE integration_generations SET status = 'retired', retired_at = ? WHERE id = 'generation-1'").run(now.toISOString());
  const generationProof = proofFor(generation.proposal.operation.operation_id, "approved", 12);
  await assert.rejects(
    generation.approval.decide({ actor: owner, requestId: "request-generation-stale", clientId: "client-1", adAccountId: "act_1", operationId: generation.proposal.operation.operation_id, decision: "approved", method: "POST", path: generationProof.path, body: Buffer.alloc(0), proof: generationProof.proof }),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "operation_stale",
  );
  assert.equal(generation.db.prepare("SELECT status FROM operations").get()!.status, "stale");
  const staleRow = generation.db.prepare("SELECT id, payload_hash FROM operations").get()!;
  const staleNonce = generation.db.prepare("SELECT nonce FROM proof_nonces").get()!;
  assert.throws(() => generation.db.prepare(`INSERT INTO approval_decisions
    (id, operation_id, payload_hash, decision, owner_identity, decided_at, nonce, correlation_id)
    VALUES ('forged-decision', ?, ?, 'approved', ?, ?, ?, 'forged-request')`)
    .run(String(staleRow.id), String(staleRow.payload_hash), owner, now.toISOString(), String(staleNonce.nonce)), /pending|constraint/i);

  const media = await fixture(t, { campaign: true });
  const stored = media.db.prepare("SELECT storage_name FROM staged_media WHERE id = ?").get(media.staged!.media.media_id)!;
  await writeFile(join(media.mediaRoot, String(stored.storage_name)), "tampered", { mode: 0o600 });
  const mediaProof = proofFor(media.proposal.operation.operation_id, "approved", 13);
  await assert.rejects(
    media.approval.decide({ actor: owner, requestId: "request-media-stale", clientId: "client-1", adAccountId: "act_1", operationId: media.proposal.operation.operation_id, decision: "approved", method: "POST", path: mediaProof.path, body: Buffer.alloc(0), proof: mediaProof.proof }),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "operation_stale",
  );
  assert.equal(media.db.prepare("SELECT status FROM operations").get()!.status, "stale");
  assert.equal(media.db.prepare("SELECT status FROM staged_media").get()!.status, "invalid");
  await assert.rejects(stat(join(media.mediaRoot, String(stored.storage_name))));
  assert.throws(() => media.db.prepare("UPDATE operations SET payload_hash = ?").run("0".repeat(64)), /immutable/);
});

test("expires instead of approving when revalidation crosses the exact operation deadline", async (t) => {
  const value = await fixture(t, { crossExpiryDuringRevalidation: true });
  const operationId = value.proposal.operation.operation_id;
  const signed = proofFor(operationId, "approved", 18);
  await assert.rejects(
    value.approval.decide({ actor: owner, requestId: "request-cross-expiry", clientId: "client-1", adAccountId: "act_1", operationId, decision: "approved", method: "POST", path: signed.path, body: Buffer.alloc(0), proof: signed.proof }),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "operation_expired",
  );
  assert.equal(value.db.prepare("SELECT status FROM operations WHERE id = ?").get(operationId)!.status, "expired");
  assert.equal(value.db.prepare("SELECT count(*) AS count FROM approval_decisions WHERE operation_id = ?").get(operationId)!.count, 0);
});

test("rejects approval when authoritative generation changes during or immediately after async revalidation", async (t) => {
  for (const [name, options, nonce] of [
    ["during target validation", { targetOperation: true, rotateGenerationDuringTarget: true }, 22],
    ["after revalidation", { rotateGenerationAfterRevalidation: true }, 23],
  ] as const) {
    const value = await fixture(t, options);
    const operationId = value.proposal.operation.operation_id;
    const signed = proofFor(operationId, "approved", nonce);
    await assert.rejects(
      value.approval.decide({ actor: owner, requestId: `request-generation-race-${nonce}`, clientId: "client-1", adAccountId: "act_1", operationId, decision: "approved", method: "POST", path: signed.path, body: Buffer.alloc(0), proof: signed.proof }),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "operation_stale",
      name,
    );
    assert.equal(value.db.prepare("SELECT status FROM operations WHERE id = ?").get(operationId)!.status, "stale");
    assert.equal(value.db.prepare("SELECT count(*) AS count FROM approval_decisions WHERE operation_id = ?").get(operationId)!.count, 0);
    assert.deepEqual({ ...value.db.prepare("SELECT correlation_id, json_extract(evidence, '$.errorCode') AS code FROM audit_log WHERE logical_operation = 'approve_operation' ORDER BY rowid DESC LIMIT 1").get() }, {
      correlation_id: `request-generation-race-${nonce}`,
      code: "operation_stale",
    });
  }
});

test("rejects a proof that crosses freshness during secret lookup without consuming its nonce", async (t) => {
  const value = await fixture(t, { crossProofExpiryDuringSecretLookup: true });
  const operationId = value.proposal.operation.operation_id;
  const signed = proofFor(operationId, "approved", 24, new Date(now.getTime() - 300_000));
  await assert.rejects(
    value.approval.decide({ actor: owner, requestId: "request-secret-expiry", clientId: "client-1", adAccountId: "act_1", operationId, decision: "approved", method: "POST", path: signed.path, body: Buffer.alloc(0), proof: signed.proof }),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "forbidden",
  );
  assert.equal(value.db.prepare("SELECT count(*) AS count FROM proof_nonces").get()!.count, 0);
  assert.equal(value.db.prepare("SELECT count(*) AS count FROM approval_decisions").get()!.count, 0);
  assert.deepEqual({ ...value.db.prepare("SELECT correlation_id, json_extract(evidence, '$.errorCode') AS code FROM audit_log WHERE logical_operation = 'approve_operation' ORDER BY rowid DESC LIMIT 1").get() }, {
    correlation_id: "request-secret-expiry",
    code: "forbidden",
  });
});

test("reconciles terminal media after deletion fails and the service restarts", async (t) => {
  const value = await fixture(t, { campaign: true, failMediaDelete: true });
  const operationId = value.proposal.operation.operation_id;
  const row = value.db.prepare("SELECT storage_name FROM staged_media WHERE id = ?").get(value.staged!.media.media_id)!;
  const signed = proofFor(operationId, "rejected", 19);
  await assert.rejects(value.approval.decide({ actor: owner, requestId: "request-delete-crash", clientId: "client-1", adAccountId: "act_1", operationId, decision: "rejected", method: "POST", path: signed.path, body: Buffer.alloc(0), proof: signed.proof }), /delete failure/);
  assert.equal(value.db.prepare("SELECT status FROM staged_media WHERE id = ?").get(value.staged!.media.media_id)!.status, "consumed");
  assert.equal((await stat(join(value.mediaRoot, String(row.storage_name)))).isFile(), true);
  const outside = join(value.root, "outside-canary");
  await writeFile(outside, "preserve");
  await writeFile(join(value.mediaRoot, "orphan.tmp"), "orphan");
  await symlink(outside, join(value.mediaRoot, "orphan-link"));
  await createMediaService({ db: value.db, dataRoot: value.root, mediaRoot: value.mediaRoot, now: () => now });
  await assert.rejects(stat(join(value.mediaRoot, String(row.storage_name))));
  await assert.rejects(stat(join(value.mediaRoot, "orphan.tmp")));
  await assert.rejects(stat(join(value.mediaRoot, "orphan-link")));
  assert.equal(await readFile(outside, "utf8"), "preserve");
});

test("durably rate-limits approval attempts before processing without silently dropping admitted audits", async (t) => {
  const value = await fixture(t, { rateLimit: { windowSeconds: 60, globalLimit: 2, ownerLimit: 1 } });
  const operationId = value.proposal.operation.operation_id;
  await assert.rejects(value.approval.decide({ actor: owner, requestId: "request-bad-proof-0", clientId: "client-1", adAccountId: "act_1", operationId, decision: "approved", method: "POST", path: "/wrong", body: Buffer.alloc(0), proof: "invalid" }), ApprovalError);
  await assert.rejects(
    value.approval.decide({ actor: owner, requestId: "request-bad-proof-1", clientId: "client-1", adAccountId: "act_1", operationId, decision: "approved", method: "POST", path: "/wrong", body: Buffer.alloc(0), proof: "invalid" }),
    (error: unknown) => error instanceof ApprovalError && error.status === 429 && error.code === "rate_limited" && error.retryAfterSeconds === 60,
  );
  assert.equal(value.db.prepare("SELECT count(*) AS count FROM audit_log WHERE logical_operation = 'approve_operation' AND outcome = 'failed'").get()!.count, 1);
  assert.deepEqual(value.db.prepare("SELECT scope, admitted_count, rejected_count FROM approval_rate_limits ORDER BY scope").all().map((row) => ({ ...row })), [
    { scope: "global", admitted_count: 1, rejected_count: 1 },
    { scope: "owner", admitted_count: 1, rejected_count: 1 },
  ]);

  const app = await buildApp({ serviceToken: "service-token", handlers: createApprovalHandlers(value.approval, owner) });
  t.after(() => app.close());
  const shaped = proofFor(operationId, "approved", 25);
  const invalid = `${shaped.proof.slice(0, -1)}${shaped.proof.endsWith("A") ? "B" : "A"}`;
  const response = await app.inject({ method: "POST", url: shaped.path, headers: { authorization: "Bearer service-token", "x-openclaw-owner-command": invalid, "x-request-id": "request-rate-limited" } });
  assert.equal(response.statusCode, 429);
  assert.equal(response.headers["retry-after"], "60");
  assert.deepEqual(response.json(), {
    type: "urn:fb-marketing-server:rate_limited", title: "Rate limited", status: 429, code: "rate_limited",
    detail: "Owner decision rate limit exceeded", request_id: "request-rate-limited",
  });
  const rejectedPath = `/v1/operations/${operationId}/reject?client_id=client-1&ad_account_id=act_1`;
  const rejected = await app.inject({ method: "POST", url: rejectedPath, headers: { authorization: "Bearer service-token", "x-openclaw-owner-command": invalid, "x-request-id": "request-reject-rate-limited" } });
  assert.equal(rejected.statusCode, 429);
  assert.equal(rejected.json().code, "rate_limited");
});

test("purges only irreversibly expired unreferenced proof nonces and preserves decision evidence", async (t) => {
  const value = await fixture(t, { failRevalidation: true });
  const operationId = value.proposal.operation.operation_id;
  const signed = proofFor(operationId, "approved", 26);
  await assert.rejects(value.approval.decide({ actor: owner, requestId: "request-unreferenced", clientId: "client-1", adAccountId: "act_1", operationId, decision: "approved", method: "POST", path: signed.path, body: Buffer.alloc(0), proof: signed.proof }), ApprovalError);
  assert.equal(value.db.prepare("SELECT count(*) AS count FROM proof_nonces").get()!.count, 1);
  assert.throws(() => value.db.prepare("DELETE FROM proof_nonces").run(), /replay horizon/);
  value.setNow(new Date(now.getTime() + 301_000));
  value.approval.purgeExpiredNonces();
  assert.equal(value.db.prepare("SELECT count(*) AS count FROM proof_nonces").get()!.count, 0);

  const decided = await fixture(t);
  const decidedId = decided.proposal.operation.operation_id;
  const accepted = proofFor(decidedId, "approved", 27);
  await decided.approval.decide({ actor: owner, requestId: "request-referenced", clientId: "client-1", adAccountId: "act_1", operationId: decidedId, decision: "approved", method: "POST", path: accepted.path, body: Buffer.alloc(0), proof: accepted.proof });
  decided.setNow(new Date(now.getTime() + 301_000));
  decided.approval.purgeExpiredNonces();
  assert.equal(decided.db.prepare("SELECT count(*) AS count FROM proof_nonces").get()!.count, 1);
  assert.throws(() => decided.db.prepare("DELETE FROM proof_nonces").run(), /decision|replay horizon/i);

  const bounded = await fixture(t, { failRevalidation: true, rateLimit: { windowSeconds: 60, globalLimit: 1, ownerLimit: 1 } });
  for (let minute = 0; minute <= 6; minute += 1) {
    const at = new Date(now.getTime() + minute * 60_000);
    bounded.setNow(at);
    const attempt = proofFor(bounded.proposal.operation.operation_id, "approved", 28 + minute, at);
    await assert.rejects(bounded.approval.decide({ actor: owner, requestId: `request-retention-${minute}`, clientId: "client-1", adAccountId: "act_1", operationId: bounded.proposal.operation.operation_id, decision: "approved", method: "POST", path: attempt.path, body: Buffer.alloc(0), proof: attempt.proof }), ApprovalError);
  }
  assert.equal(bounded.db.prepare("SELECT count(*) AS count FROM proof_nonces").get()!.count, 6);
});

test("rolls back decision, operation state, and linked audit together when decision commit crashes", async (t) => {
  const value = await fixture(t, { beforeDecisionCommit: () => { throw new Error("crash before commit"); } });
  const operationId = value.proposal.operation.operation_id;
  const proof = proofFor(operationId, "rejected", 14);
  await assert.rejects(
    value.approval.decide({ actor: owner, requestId: "request-crash", clientId: "client-1", adAccountId: "act_1", operationId, decision: "rejected", method: "POST", path: proof.path, body: Buffer.alloc(0), proof: proof.proof }),
    /crash before commit/,
  );
  assert.equal(value.db.prepare("SELECT count(*) AS count FROM approval_decisions").get()!.count, 0);
  assert.equal(value.db.prepare("SELECT status FROM operations WHERE id = ?").get(operationId)!.status, "pending");
  assert.equal(value.db.prepare("SELECT count(*) AS count FROM operation_audit_links WHERE decision_id IS NOT NULL").get()!.count, 0);
  assert.equal(value.db.prepare("SELECT count(*) AS count FROM proof_nonces").get()!.count, 1);
});

test("owner-command handlers return contract-valid correlated 202 approval and 200 rejection without Meta writes", async (t) => {
  const approvedValue = await fixture(t);
  const approvedId = approvedValue.proposal.operation.operation_id;
  const approvedProof = proofFor(approvedId, "approved", 15);
  const approvedApp = await buildApp({ serviceToken: "service-token", handlers: createApprovalHandlers(approvedValue.approval, owner) });
  t.after(() => approvedApp.close());
  const missing = await approvedApp.inject({
    method: "POST",
    url: approvedProof.path,
    headers: { authorization: "Bearer service-token", "x-request-id": "request-missing-proof" },
  });
  assert.equal(missing.statusCode, 400);
  const approved = await approvedApp.inject({
    method: "POST",
    url: approvedProof.path,
    headers: { authorization: "Bearer service-token", "x-request-id": "request-approved-route", "x-openclaw-owner-command": approvedProof.proof },
  });
  assert.equal(approved.statusCode, 202);
  assert.equal(approved.headers["x-request-id"], "request-approved-route");
  assert.equal(approved.json().request_id, "request-approved-route");
  assert.equal(approved.json().operation.status, "pending");
  assert.equal(approved.json().operation.next_action, "approve_or_reject");
  assert.equal(approved.json().operation.decision.decision, "approved");

  const invalidProof = `${approvedProof.proof.slice(0, -1)}${approvedProof.proof.endsWith("A") ? "B" : "A"}`;
  const failed = await approvedApp.inject({
    method: "POST",
    url: approvedProof.path,
    headers: { authorization: "Bearer service-token", "x-openclaw-owner-command": invalidProof },
  });
  const generated = failed.headers["x-request-id"];
  assert.equal(failed.statusCode, 403);
  assert.match(String(generated), /^[0-9a-f-]{36}$/);
  assert.equal(failed.json().request_id, generated);
  assert.equal(approvedValue.db.prepare("SELECT correlation_id FROM audit_log WHERE logical_operation = 'approve_operation' AND outcome = 'failed' ORDER BY rowid DESC").get()!.correlation_id, generated);

  const rejectedValue = await fixture(t);
  const rejectedId = rejectedValue.proposal.operation.operation_id;
  const rejectedProof = proofFor(rejectedId, "rejected", 16);
  const rejectedApp = await buildApp({ serviceToken: "service-token", handlers: createApprovalHandlers(rejectedValue.approval, owner) });
  t.after(() => rejectedApp.close());
  const rejected = await rejectedApp.inject({
    method: "POST",
    url: rejectedProof.path,
    headers: { authorization: "Bearer service-token", "x-request-id": "request-rejected-route", "x-openclaw-owner-command": rejectedProof.proof },
  });
  assert.equal(rejected.statusCode, 200);
  assert.equal(rejected.json().operation.status, "rejected");
  assert.equal(rejected.json().operation.next_action, "no_action");
  assert.equal(rejected.json().operation.decision.decision, "rejected");
});

test("raw chunked approval and rejection bodies fail closed before decision processing", async (t) => {
  for (const [decision, nonce] of [["approved", 40], ["rejected", 41]] as const) {
    const value = await fixture(t);
    const operationId = value.proposal.operation.operation_id;
    const signed = proofFor(operationId, decision, nonce);
    const app = await buildApp({ serviceToken: "service-token", handlers: createApprovalHandlers(value.approval, owner) });
    t.after(() => app.close());
    const multipart = "--x\r\nContent-Disposition: form-data; name=\"unexpected\"\r\n\r\nvalue\r\n--x--\r\n";
    const requestIdValue = `request-chunked-${decision}`;
    const response = await rawHttp(app, [
      `POST ${signed.path} HTTP/1.1`,
      "Host: 127.0.0.1",
      "Authorization: Bearer service-token",
      `X-Request-ID: ${requestIdValue}`,
      `X-OpenClaw-Owner-Command: ${signed.proof}`,
      "Transfer-Encoding: chunked",
      "Content-Type: multipart/form-data; boundary=x",
      "Connection: close",
      "",
      `${Buffer.byteLength(multipart).toString(16)}\r\n${multipart}\r\n0\r\n\r\n`,
    ].join("\r\n"));
    assert.equal(response.status, 400);
    assert.equal(response.headers["x-request-id"], requestIdValue);
    assert.deepEqual(response.body, {
      type: "urn:fb-marketing-server:validation_error", title: "Bad request", status: 400, code: "validation_error",
      detail: "Owner command body must be empty", request_id: requestIdValue,
    });
    assert.equal(value.db.prepare("SELECT count(*) AS count FROM approval_decisions").get()!.count, 0);
    assert.equal(value.db.prepare("SELECT status FROM operations WHERE id = ?").get(operationId)!.status, "pending");
    assert.equal(value.db.prepare("SELECT count(*) AS count FROM proof_nonces").get()!.count, 0);
    assert.equal(value.db.prepare("SELECT count(*) AS count FROM audit_log WHERE logical_operation IN ('approve_operation', 'reject_operation')").get()!.count, 0);
    assert.equal(value.secrets.gets, 0);
  }
});

test("approval framing rejects every body signal while truly empty approval and rejection remain valid", async (t) => {
  for (const [name, headers, payload] of [
    ["transfer encoding", { "transfer-encoding": "identity" }, undefined],
    ["nonzero length", { "content-length": "2", "content-type": "text/plain" }, "ok"],
    ["malformed length", { "content-length": "banana" }, undefined],
  ] as const) {
    const value = await fixture(t);
    const signed = proofFor(value.proposal.operation.operation_id, "approved", 42);
    const app = await buildApp({ serviceToken: "service-token", handlers: createApprovalHandlers(value.approval, owner) });
    t.after(() => app.close());
    const response = await app.inject({ method: "POST", url: signed.path, headers: { authorization: "Bearer service-token", "x-request-id": `request-${name.replaceAll(" ", "-")}`, "x-openclaw-owner-command": signed.proof, ...headers }, ...(payload === undefined ? {} : { payload }) });
    assert.equal(response.statusCode, 400, name);
    assert.equal(value.db.prepare("SELECT count(*) AS count FROM approval_decisions").get()!.count, 0, name);
    assert.equal(value.secrets.gets, 0, name);
  }

  const parsed = await fixture(t);
  const parsedResponse = await createApprovalHandlers(parsed.approval, owner).approveOperation!(
    { request: { headers: { "x-request-id": "request-parsed-body" } } } as never,
    { headers: { "content-length": "0" }, body: { unexpected: true } } as never,
  );
  assert.equal((parsedResponse as { statusCode: number }).statusCode, 400);
  assert.equal(parsed.db.prepare("SELECT count(*) AS count FROM approval_decisions").get()!.count, 0);
  assert.equal(parsed.secrets.gets, 0);

  const duplicate = await fixture(t);
  const duplicateProof = proofFor(duplicate.proposal.operation.operation_id, "approved", 43);
  const duplicateApp = await buildApp({ serviceToken: "service-token", handlers: createApprovalHandlers(duplicate.approval, owner) });
  t.after(() => duplicateApp.close());
  const duplicateResponse = await rawHttp(duplicateApp, [
    `POST ${duplicateProof.path} HTTP/1.1`, "Host: 127.0.0.1", "Authorization: Bearer service-token",
    `X-OpenClaw-Owner-Command: ${duplicateProof.proof}`, "Content-Length: 0", "Content-Length: 0", "Connection: close", "", "",
  ].join("\r\n"));
  assert.equal(duplicateResponse.status, 400);
  assert.equal(duplicate.db.prepare("SELECT count(*) AS count FROM approval_decisions").get()!.count, 0);

  for (const [decision, nonce, status] of [["approved", 44, 202], ["rejected", 45, 200]] as const) {
    const valid = await fixture(t);
    const signed = proofFor(valid.proposal.operation.operation_id, decision, nonce);
    const app = await buildApp({ serviceToken: "service-token", handlers: createApprovalHandlers(valid.approval, owner) });
    t.after(() => app.close());
    const response = await app.inject({ method: "POST", url: signed.path, headers: { authorization: "Bearer service-token", "x-openclaw-owner-command": signed.proof } });
    assert.equal(response.statusCode, status);
    assert.equal(valid.db.prepare("SELECT count(*) AS count FROM approval_decisions").get()!.count, 1);
    assert.equal(valid.secrets.gets, 1);
  }
});

test("documents the exact model-inaccessible owner proof protocol", async () => {
  const architecture = await readFile(new URL("../docs/architecture.md", import.meta.url), "utf8");
  assert.match(architecture, /v1\.<issued_at_unix_seconds>\.<nonce_base64url>\.<owner_identity_base64url>\.<signature_base64url>/);
  assert.match(architecture, /HMAC-SHA256/);
  assert.match(architecture, /exact request method, raw path including query string, and SHA-256 body hash/);
  assert.match(architecture, /valid through exactly 300 seconds and MUST NOT be issued in the future/);
  assert.match(architecture, /at most 120 admitted attempts per minute globally and 60 per minute for the configured owner/);
  assert.match(architecture, /any `Transfer-Encoding`, non-canonical or nonzero `Content-Length`, or parsed body is rejected/);
  assert.match(architecture, /OPENCLAW_OWNER_IDENTITY/);
});
