import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { createApprovalHandlers, createApprovalService, signOwnerProof } from "../src/approval.js";
import { buildApp } from "../src/app.js";
import { openDatabase } from "../src/db.js";
import { createMediaService } from "../src/media.js";
import { createOperationsService } from "../src/operations.js";
import type { SecretProvider } from "../src/secrets.js";

const now = new Date("2026-08-19T12:00:00.000Z");
const owner = "discord:user-1";
const proofSecret = Buffer.alloc(32, 9).toString("base64");
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

class FakeSecrets implements SecretProvider {
  readonly values = new Map([["owner-proof-hmac-key", proofSecret]]);
  async get(name: string) { return this.values.get(name); }
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

async function fixture(t: TestContext, options: { campaign?: boolean; failRevalidation?: boolean; beforeDecisionCommit?: () => void } = {}) {
  const root = await mkdtemp(join(tmpdir(), "fb-marketing-server-approval-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const db = openDatabase(":memory:");
  t.after(() => db.close());
  seed(db);
  const mediaRoot = join(root, "media");
  const media = await createMediaService({ db, dataRoot: root, mediaRoot, now: () => now });
  let staged: Awaited<ReturnType<Awaited<ReturnType<typeof createMediaService>>["stage"]>> | undefined;
  if (options.campaign) {
    staged = await media.stage({
      actor: "openclaw:user-1", requestId: "request-stage-approval", clientId: "client-1", adAccountId: "act_1",
      attachment: { source: "openclaw_chat_attachment", attachment_id: "attachment-approval", original_filename: "creative.png", declared_content_type: "image/png" },
      declaredFileType: "image/png", bytes: (async function* () { yield png; })(),
    });
  }
  let current = now;
  const operations = createOperationsService({
    db,
    mediaRoot,
    now: () => current,
    capabilities: async () => ({
      assets: [{ asset_type: "page", page_id: "page-1", name: "Page" }, { asset_type: "pixel", pixel_id: "pixel-1", name: "Pixel" }],
      capabilities: { sales_website: { status: "available" }, leads_website: { status: "available" }, leads_instant_form: { status: "available" } },
    }),
    validateTarget: async () => true,
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
      : { type: "configure_monthly_budget", client_id: "client-1", ad_account_id: "act_1", payload: { monthly_budget: { amount: "100.00", currency: "USD" } } },
  });
  const secrets = new FakeSecrets();
  const approval = createApprovalService({
    db,
    secrets,
    ownerIdentity: owner,
    now: () => current,
    revalidate: options.failRevalidation ? async () => { throw new Error("stale"); } : operations.revalidate,
    cleanupOperationMedia: media.cleanupOperation,
    ...(options.beforeDecisionCommit === undefined ? {} : { testHooks: { beforeDecisionCommit: options.beforeDecisionCommit } }),
  });
  return { db, approval, operations, proposal, secrets, staged, mediaRoot, setNow: (value: Date) => { current = value; } };
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
  assert.equal(approved.json().operation.decision.decision, "approved");

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
  assert.equal(rejected.json().operation.decision.decision, "rejected");
});

test("documents the exact model-inaccessible owner proof protocol", async () => {
  const architecture = await readFile(new URL("../docs/architecture.md", import.meta.url), "utf8");
  assert.match(architecture, /v1\.<issued_at_unix_seconds>\.<nonce_base64url>\.<owner_identity_base64url>\.<signature_base64url>/);
  assert.match(architecture, /HMAC-SHA256/);
  assert.match(architecture, /exact request method, raw path including query string, and SHA-256 body hash/);
  assert.match(architecture, /valid for 300 seconds and MUST NOT be issued in the future/);
  assert.match(architecture, /OPENCLAW_OWNER_IDENTITY/);
});
