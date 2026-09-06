import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { openDatabase } from "../src/db.js";
import { MetaError } from "../src/meta-client.js";
import { OperationError, canonicalPayload, createExecutionService } from "../src/operations.js";

const now = new Date("2026-08-19T12:00:00.000Z");
const mediaBytes = Buffer.from("trusted-image");
const mediaHash = createHash("sha256").update(mediaBytes).digest("hex");

function fixture() {
  const db = openDatabase(":memory:");
  db.exec(`
    INSERT INTO clients (id, name, portfolio_id) VALUES ('client-1', 'Client One', 'portfolio-1');
    INSERT INTO integrations (id, name, meta_app_id, state) VALUES ('integration-1', 'App', 'app-1', 'active');
    INSERT INTO integration_generations (id, integration_id, generation, status, validated_at)
      VALUES ('generation-1', 'integration-1', '1', 'active', '${now.toISOString()}');
    INSERT INTO ad_accounts (id, client_id, name, currency, timezone)
      VALUES ('act_1', 'client-1', 'Account One', 'USD', 'America/New_York');
    INSERT INTO scope_mappings
      (client_id, ad_account_id, generation_id, active, app_authorized, subject_authorized, partner_authorized, asset_authorized, granted_tasks)
      VALUES ('client-1', 'act_1', 'generation-1', 1, 1, 1, 1, 1, '["ADVERTISE"]');
    INSERT INTO encrypted_credentials
      (id, generation_id, subject_id, key_ref, envelope_version, ciphertext, iv, auth_tag, scopes, status, validated_at)
      VALUES ('credential-1', 'generation-1', 'subject-1', 'key', 1, 'cipher', 'iv', 'tag',
        '["ads_management"]', 'active', '${now.toISOString()}');
  `);
  const payload = {
    campaign_kind: "SALES_WEBSITE",
    campaign: { name: "Sales", budget: { kind: "daily", value: { amount: "10.00", currency: "USD" } } },
    ad_set: { name: "Sales set", pixel_id: "pixel-1", targeting: { countries: ["US"], minimum_age: 21, maximum_age: 55 } },
    creative: {
      name: "Creative", page_id: "page-1", message: "Buy now", headline: "Offer",
      website_url: "https://example.com/product", call_to_action: "SHOP_NOW",
      media: [{ media_id: "media-1", sha256: mediaHash }],
    },
    ad: { name: "Sales ad" },
  };
  const payloadJson = canonicalPayload(payload);
  const payloadHash = createHash("sha256").update(payloadJson).digest("hex");
  db.prepare(`INSERT INTO operations
    (id, actor, client_id, ad_account_id, generation_id, operation_type, payload_json, payload_hash,
     derived_json, status, created_at, expires_at)
    VALUES (?, 'openclaw', 'client-1', 'act_1', 'generation-1', 'create_campaign_bundle', ?, ?, ?, 'pending', ?, ?)`)
    .run("operation-1", payloadJson, payloadHash, canonicalPayload({
      objective: "OUTCOME_SALES", destination: "WEBSITE", optimization_goal: "OFFSITE_CONVERSIONS",
      billing_event: "IMPRESSIONS", conversion_event: "PURCHASE",
    }), now.toISOString(), "2026-08-20T00:00:00.000Z");
  db.prepare(`INSERT INTO staged_media
    (id, client_id, ad_account_id, generation_id, sha256, media_type, content_type, size_bytes,
     original_filename, attachment_id, actor, correlation_id, storage_name, status, created_at, expires_at)
    VALUES ('media-1', 'client-1', 'act_1', 'generation-1', ?, 'image', 'image/png', ?,
      'creative.png', 'attachment-1', 'openclaw', 'request-media', '00000000-0000-4000-8000-000000000001', 'bound', ?, '2026-08-20T00:00:00.000Z')`)
    .run(mediaHash, mediaBytes.byteLength, now.toISOString());
  db.prepare(`INSERT INTO operation_media (operation_id, media_id, media_hash, client_id, ad_account_id)
    VALUES ('operation-1', 'media-1', ?, 'client-1', 'act_1')`).run(mediaHash);
  db.prepare(`INSERT INTO proof_nonces
    (nonce, owner_identity, operation_id, decision, body_hash, issued_at, consumed_at, correlation_id, purge_after)
    VALUES ('AAAAAAAAAAAAAAAAAAAAAA', 'discord:owner', 'operation-1', 'approved', ?, 1, ?, 'request-approval', 301)`)
    .run("0".repeat(64), now.toISOString());
  db.prepare(`INSERT INTO approval_decisions
    (id, operation_id, payload_hash, decision, owner_identity, decided_at, nonce, correlation_id)
    VALUES ('decision-1', 'operation-1', ?, 'approved', 'discord:owner', ?, 'AAAAAAAAAAAAAAAAAAAAAA', 'request-approval')`)
    .run(payloadHash, now.toISOString());
  return { db, payload };
}

function addApprovedOperation(db: ReturnType<typeof openDatabase>, id: string, type: string, payload: object, nonceByte: string, derived: object = {}) {
  const payloadJson = canonicalPayload(payload);
  const payloadHash = createHash("sha256").update(payloadJson).digest("hex");
  const mutation = payload as { object_type?: string; object_id?: string };
  const targetType = type === "update_object"
    ? mutation.object_type
    : type === "change_delivery" ? ({ Campaign: "campaign", AdSet: "ad_set", Ad: "ad" } as Record<string, string>)[mutation.object_type ?? ""] : undefined;
  const storedDerived = Object.keys(derived).length > 0 || targetType === undefined
    ? derived
    : { target: { object_type: targetType, object_id: mutation.object_id, ad_account_id: "act_1" } };
  db.prepare(`INSERT INTO operations
    (id, actor, client_id, ad_account_id, generation_id, operation_type, payload_json, payload_hash,
     derived_json, status, created_at, expires_at)
    VALUES (?, 'openclaw', 'client-1', 'act_1', 'generation-1', ?, ?, ?, ?, 'pending', ?, ?)`)
    .run(id, type, payloadJson, payloadHash, canonicalPayload(storedDerived), now.toISOString(), "2026-08-20T00:00:00.000Z");
  const nonce = nonceByte.repeat(22);
  db.prepare(`INSERT INTO proof_nonces
    (nonce, owner_identity, operation_id, decision, body_hash, issued_at, consumed_at, correlation_id, purge_after)
    VALUES (?, 'discord:owner', ?, 'approved', ?, 1, ?, ?, 301)`)
    .run(nonce, id, "0".repeat(64), now.toISOString(), `request-${id}`);
  db.prepare(`INSERT INTO approval_decisions
    (id, operation_id, payload_hash, decision, owner_identity, decided_at, nonce, correlation_id)
    VALUES (?, ?, ?, 'approved', 'discord:owner', ?, ?, ?)`)
    .run(`decision-${id}`, id, payloadHash, now.toISOString(), nonce, `request-${id}`);
}

function prepareCompleteBundleExecution(db: ReturnType<typeof openDatabase>, executionId = "complete-execution"): void {
  const hash = String(db.prepare("SELECT payload_hash FROM operations WHERE id = 'operation-1'").get()!.payload_hash);
  db.prepare(`INSERT INTO operation_executions
    (id, operation_id, decision_id, payload_hash, status, claimed_at, correlation_id)
    VALUES (?, 'operation-1', 'decision-1', ?, 'running', ?, 'request-complete')`).run(executionId, hash, now.toISOString());
  db.prepare("UPDATE operations SET status = 'executing' WHERE id = 'operation-1'").run();
  for (const [stepKey, sequence, kind, externalId] of [
    ["media:media-1", 0, "image", "image-hash-1"], ["campaign", 1, "campaign", "campaign-1"],
    ["ad_set", 2, "ad_set", "adset-1"], ["creative", 3, "creative", "creative-1"], ["ad", 4, "ad", "ad-1"],
  ] as const) {
    db.prepare(`INSERT INTO operation_steps
      (execution_id, operation_id, step_key, sequence, kind, status, request_hash, correlation_id, attempted_at)
      VALUES (?, 'operation-1', ?, ?, ?, 'intent', ?, ?, ?)`).run(executionId, stepKey, sequence, kind, "0".repeat(64), `request-complete-${sequence}`, now.toISOString());
    db.prepare(`UPDATE operation_steps SET status = 'succeeded', external_id = ?, completed_at = ?
      WHERE execution_id = ? AND step_key = ?`).run(externalId, now.toISOString(), executionId, stepKey);
  }
}

function prepareBundleExecutionThroughCampaign(db: ReturnType<typeof openDatabase>, executionId: string): void {
  const hash = String(db.prepare("SELECT payload_hash FROM operations WHERE id = 'operation-1'").get()!.payload_hash);
  db.prepare(`INSERT INTO operation_executions
    (id, operation_id, decision_id, payload_hash, status, claimed_at, correlation_id)
    VALUES (?, 'operation-1', 'decision-1', ?, 'running', ?, 'request-partial')`).run(executionId, hash, now.toISOString());
  db.prepare("UPDATE operations SET status = 'executing' WHERE id = 'operation-1'").run();
  for (const [stepKey, sequence, kind, externalId] of [
    ["media:media-1", 0, "image", "image-hash-1"], ["campaign", 1, "campaign", "campaign-1"],
  ] as const) {
    db.prepare(`INSERT INTO operation_steps
      (execution_id, operation_id, step_key, sequence, kind, status, request_hash, correlation_id, attempted_at)
      VALUES (?, 'operation-1', ?, ?, ?, 'intent', ?, ?, ?)`).run(executionId, stepKey, sequence, kind, "0".repeat(64), `request-partial-${sequence}`, now.toISOString());
    db.prepare(`UPDATE operation_steps SET status = 'succeeded', external_id = ?, completed_at = ?
      WHERE execution_id = ? AND step_key = ?`).run(externalId, now.toISOString(), executionId, stepKey);
  }
}

test("claims and audits an approved campaign under its original request ID", async (t) => {
  const { db } = fixture();
  t.after(() => db.close());
  const calls: Array<{ path: string; body: unknown; executionStep?: { executionId: string; stepKey: string } }> = [];
  const responses = [
    { images: { upload: { hash: "image-hash-1" } } },
    { id: "campaign-1" },
    { id: "adset-1" },
    { id: "creative-1" },
    { id: "ad-1" },
  ];
  let revalidations = 0;
  const execution = createExecutionService({
    db,
    now: () => now,
    revalidate: async () => { revalidations += 1; },
    readMedia: async () => ({ contentType: "image/png" as const, bytes: mediaBytes }),
    cleanupOperationMedia: async () => 1,
    meta: {
      request: async (request: { path: string; body?: unknown; executionStep?: { executionId: string; stepKey: string } }) => {
        calls.push({ path: request.path, body: request.body, ...(request.executionStep === undefined ? {} : { executionStep: request.executionStep }) });
        return { data: responses[calls.length - 1], rate: {} };
      },
    },
  });

  const first = await execution.execute({ operationId: "operation-1", actor: "discord:owner", requestId: "request-execute-1" });
  const replay = await execution.execute({ operationId: "operation-1", actor: "discord:owner", requestId: "request-execute-2" });

  assert.equal(revalidations, 6);
  assert.deepEqual(calls.map(({ path }) => path), [
    "/act_1/adimages", "/act_1/campaigns", "/act_1/adsets", "/act_1/adcreatives", "/act_1/ads",
  ]);
  assert.deepEqual(calls.slice(1).map(({ body }) => (body as { status?: string }).status), ["PAUSED", "PAUSED", undefined, "PAUSED"]);
  assert.equal(new Set(calls.map(({ executionStep }) => `${executionStep?.executionId}:${executionStep?.stepKey}`)).size, 5);
  assert.deepEqual(calls.map(({ executionStep }) => executionStep?.stepKey), ["media:media-1", "campaign", "ad_set", "creative", "ad"]);
  assert.deepEqual(first.result, {
    status: "succeeded", completed_at: now.toISOString(),
    campaign: { object_id: "campaign-1", delivery_status: "PAUSED" },
    ad_set: { object_id: "adset-1", delivery_status: "PAUSED" },
    creative: { object_id: "creative-1", bound: true },
    ad: { object_id: "ad-1", delivery_status: "PAUSED" },
    next_action: "no_action",
  });
  assert.deepEqual(replay, first);
  assert.equal(db.prepare("SELECT count(*) AS count FROM operation_executions").get()!.count, 1);
  assert.equal(db.prepare("SELECT count(*) AS count FROM operation_steps").get()!.count, 5);
  assert.equal(db.prepare("SELECT count(*) AS count FROM approval_decisions").get()!.count, 1);
  assert.equal(db.prepare("SELECT actor FROM audit_log WHERE logical_operation = 'execute_operation'").get()!.actor, "discord:owner");
  assert.deepEqual(db.prepare("SELECT DISTINCT correlation_id FROM operation_executions WHERE operation_id = 'operation-1'").all().map(({ correlation_id }) => String(correlation_id)), ["request-execute-1"]);
  assert.deepEqual(db.prepare("SELECT DISTINCT correlation_id FROM operation_steps WHERE operation_id = 'operation-1'").all().map(({ correlation_id }) => String(correlation_id)), ["request-execute-1"]);
  assert.equal(db.prepare(`SELECT count(*) AS count FROM operation_execution_audit_links l
    JOIN audit_log a ON a.id = l.audit_id
    WHERE l.operation_id = 'operation-1' AND a.correlation_id = 'request-execute-1'
      AND a.logical_operation IN ('execution_claim', 'execution_step_intent', 'execution_step_outcome', 'execution_result')`).get()!.count, 12);
  assert.throws(() => db.prepare("UPDATE operations SET result_json = '{}' WHERE id = 'operation-1'").run(), /immutable terminal result/i);
  assert.throws(() => db.prepare("UPDATE operation_executions SET completed_at = ? WHERE operation_id = 'operation-1'")
    .run(new Date(now.getTime() + 1_000).toISOString()), /transition|immutable/i);
});

test("database permits execution claims only for approved pending operations", (t) => {
  const { db } = fixture();
  t.after(() => db.close());
  db.prepare("UPDATE operations SET status = 'stale' WHERE id = 'operation-1'").run();
  assert.throws(() => db.prepare(`INSERT INTO operation_executions
    (id, operation_id, decision_id, payload_hash, status, claimed_at, correlation_id)
    SELECT 'forged-execution', o.id, d.id, o.payload_hash, 'running', ?, 'forged-request'
    FROM operations o JOIN approval_decisions d ON d.operation_id = o.id WHERE o.id = 'operation-1'`)
    .run(now.toISOString()), /approved pending/i);
});

test("database requires intent-first complete immutable execution history", (t) => {
  const { db } = fixture();
  t.after(() => db.close());
  const hash = db.prepare("SELECT payload_hash FROM operations WHERE id = 'operation-1'").get()!.payload_hash;
  db.prepare(`INSERT INTO operation_executions
    (id, operation_id, decision_id, payload_hash, status, claimed_at, correlation_id)
    VALUES ('execution-1', 'operation-1', 'decision-1', ?, 'running', ?, 'request-execution')`)
    .run(String(hash), now.toISOString());
  db.prepare("UPDATE operations SET status = 'executing' WHERE id = 'operation-1'").run();
  assert.throws(() => db.prepare(`INSERT INTO operation_steps
    (execution_id, operation_id, step_key, sequence, kind, status, request_hash, correlation_id, external_id, attempted_at, completed_at)
    VALUES ('execution-1', 'operation-1', 'media:media-1', 0, 'image', 'succeeded', ?, 'request-step', 'image-1', ?, ?)`)
    .run("0".repeat(64), now.toISOString(), now.toISOString()), /write intent/i);
  db.prepare(`INSERT INTO operation_steps
    (execution_id, operation_id, step_key, sequence, kind, status, request_hash, correlation_id, attempted_at)
    VALUES ('execution-1', 'operation-1', 'media:media-1', 0, 'image', 'intent', ?, 'request-step', ?)`)
    .run("0".repeat(64), now.toISOString());
  assert.throws(() => db.prepare(`UPDATE operation_steps SET status = 'succeeded', completed_at = ?
    WHERE execution_id = 'execution-1' AND step_key = 'media:media-1'`).run(now.toISOString()), /constraint/i);
  db.prepare(`UPDATE operation_steps SET status = 'succeeded', external_id = 'image-1', completed_at = ?
    WHERE execution_id = 'execution-1' AND step_key = 'media:media-1'`).run(now.toISOString());
  db.prepare(`INSERT INTO operation_steps
    (execution_id, operation_id, step_key, sequence, kind, status, request_hash, correlation_id, attempted_at)
    VALUES ('execution-1', 'operation-1', 'campaign', 1, 'campaign', 'intent', ?, 'request-campaign', ?)`).run("1".repeat(64), now.toISOString());
  assert.throws(() => db.prepare(`INSERT INTO operation_steps
    (execution_id, operation_id, step_key, sequence, kind, status, request_hash, correlation_id, attempted_at)
    VALUES ('execution-1', 'operation-1', 'ad_set', 2, 'ad_set', 'intent', ?, 'request-adset', ?)`).run("2".repeat(64), now.toISOString()), /predecessor|order/i);
});

test("database rejects skipped, out-of-order, and mismatched step intents", (t) => {
  const { db } = fixture();
  t.after(() => db.close());
  const hash = String(db.prepare("SELECT payload_hash FROM operations WHERE id = 'operation-1'").get()!.payload_hash);
  db.prepare(`INSERT INTO operation_executions
    (id, operation_id, decision_id, payload_hash, status, claimed_at, correlation_id)
    VALUES ('forged-execution', 'operation-1', 'decision-1', ?, 'running', ?, 'request-forged')`).run(hash, now.toISOString());
  assert.equal(db.prepare("SELECT count(*) AS count FROM operation_execution_audit_links WHERE execution_id = 'forged-execution'").get()!.count, 1);
  db.prepare("UPDATE operations SET status = 'executing' WHERE id = 'operation-1'").run();
  const insert = db.prepare(`INSERT INTO operation_steps
    (execution_id, operation_id, step_key, sequence, kind, status, request_hash, correlation_id, attempted_at)
    VALUES ('forged-execution', 'operation-1', ?, ?, ?, 'intent', ?, ?, ?)`);
  for (const [stepKey, sequence, kind] of [
    ["ad", 4, "ad"], ["campaign", 1, "campaign"], ["media:media-1", 0, "campaign"], ["wrong", 0, "image"],
  ] as const) {
    assert.throws(() => insert.run(stepKey, sequence, kind, "0".repeat(64), `request-forged-${stepKey}-${kind}`, now.toISOString()), /predecessor|operation type and order/i);
  }
  insert.run("media:media-1", 0, "image", "0".repeat(64), "request-forged-media", now.toISOString());
  assert.throws(() => insert.run("campaign", 1, "campaign", "1".repeat(64), "request-forged-campaign-early", now.toISOString()), /predecessor|order/i);
  db.prepare(`UPDATE operation_steps SET status = 'succeeded', external_id = 'image-1', completed_at = ?
    WHERE execution_id = 'forged-execution' AND step_key = 'media:media-1'`).run(now.toISOString());
  insert.run("campaign", 1, "campaign", "1".repeat(64), "request-forged-campaign", now.toISOString());
  assert.throws(() => insert.run("ad", 4, "ad", "4".repeat(64), "request-forged-ad", now.toISOString()), /predecessor|order/i);
  assert.throws(() => insert.run("campaign", 1, "campaign", "1".repeat(64), "request-forged-duplicate", now.toISOString()), /unique/i);
});

test("database requires the bundle media step to match its exact linked staged media", (t) => {
  const { db } = fixture();
  t.after(() => db.close());
  db.exec(`
    INSERT INTO clients (id, name, portfolio_id) VALUES ('client-2', 'Client Two', 'portfolio-2');
    INSERT INTO ad_accounts (id, client_id, name, currency, timezone) VALUES ('act_2', 'client-2', 'Account Two', 'USD', 'UTC');
    INSERT INTO scope_mappings
      (client_id, ad_account_id, generation_id, active, app_authorized, subject_authorized, partner_authorized, asset_authorized, granted_tasks)
      VALUES ('client-2', 'act_2', 'generation-1', 1, 1, 1, 1, 1, '["ADVERTISE"]');
    INSERT INTO operations
      (id, actor, client_id, ad_account_id, generation_id, operation_type, payload_json, payload_hash, derived_json, status, created_at, expires_at)
      VALUES ('operation-foreign-media', 'openclaw', 'client-2', 'act_2', 'generation-1', 'create_campaign_bundle', '{}', '${"f".repeat(64)}', '{}', 'pending', '${now.toISOString()}', '2026-08-20T00:00:00.000Z');
  `);
  db.prepare(`INSERT INTO staged_media
    (id, client_id, ad_account_id, generation_id, sha256, media_type, content_type, size_bytes,
     original_filename, attachment_id, actor, correlation_id, storage_name, status, created_at, expires_at)
    VALUES ('foreign-media', 'client-2', 'act_2', 'generation-1', ?, 'video', 'video/mp4', 1,
      'foreign.mp4', 'attachment-foreign', 'openclaw', 'request-foreign', '00000000-0000-4000-8000-000000000002', 'bound', ?, '2026-08-20T00:00:00.000Z')`)
    .run("f".repeat(64), now.toISOString());
  db.prepare(`INSERT INTO operation_media (operation_id, media_id, media_hash, client_id, ad_account_id)
    VALUES ('operation-foreign-media', 'foreign-media', ?, 'client-2', 'act_2')`).run("f".repeat(64));
  const hash = String(db.prepare("SELECT payload_hash FROM operations WHERE id = 'operation-1'").get()!.payload_hash);
  db.prepare(`INSERT INTO operation_executions
    (id, operation_id, decision_id, payload_hash, status, claimed_at, correlation_id)
    VALUES ('media-execution', 'operation-1', 'decision-1', ?, 'running', ?, 'request-media-execution')`).run(hash, now.toISOString());
  db.prepare("UPDATE operations SET status = 'executing' WHERE id = 'operation-1'").run();
  const insert = db.prepare(`INSERT INTO operation_steps
    (execution_id, operation_id, step_key, sequence, kind, status, request_hash, correlation_id, attempted_at)
    VALUES ('media-execution', 'operation-1', ?, 0, ?, 'intent', ?, ?, ?)`);
  const invalidMediaSteps: ReadonlyArray<readonly [string | null, string | null]> = [
    [null, "image"], ["media:media-1", null], ["media:", "image"], ["media: media-1", "image"],
    ["Media:media-1", "image"], ["media:missing", "image"], ["media:foreign-media", "video"], ["media:media-1", "video"],
  ];
  for (const [index, [stepKey, kind]] of invalidMediaSteps.entries()) {
    assert.throws(() => insert.run(stepKey, kind, "0".repeat(64), `request-invalid-media-${index}`, now.toISOString()), /constraint|linked media|type.*order/i);
  }
  insert.run("media:media-1", "image", "0".repeat(64), "request-valid-media", now.toISOString());
  assert.equal(db.prepare("SELECT step_key FROM operation_steps WHERE execution_id = 'media-execution'").get()!.step_key, "media:media-1");
});

test("database requires step-linked audit events to name an immutable step", (t) => {
  const { db } = fixture();
  t.after(() => db.close());
  const hash = String(db.prepare("SELECT payload_hash FROM operations WHERE id = 'operation-1'").get()!.payload_hash);
  db.prepare(`INSERT INTO operation_executions
    (id, operation_id, decision_id, payload_hash, status, claimed_at, correlation_id)
    VALUES ('audit-execution', 'operation-1', 'decision-1', ?, 'running', ?, 'request-audit-execution')`).run(hash, now.toISOString());
  db.prepare(`INSERT INTO audit_log
    (id, actor, client_id, ad_account_id, generation_id, logical_operation, correlation_id, occurred_at, outcome, evidence)
    VALUES ('forged-null-step-audit', 'discord:owner', 'client-1', 'act_1', 'generation-1', 'execute_campaign_bundle',
      'request-forged-null-step', ?, 'started', '{}')`).run(now.toISOString());
  assert.throws(() => db.prepare(`INSERT INTO operation_execution_audit_links
    (audit_id, operation_id, decision_id, execution_id, step_key, event_type)
    VALUES ('forged-null-step-audit', 'operation-1', 'decision-1', 'audit-execution', NULL, 'meta_call')`).run(), /step|constraint/i);
  db.prepare(`INSERT INTO audit_log
    (id, actor, client_id, ad_account_id, generation_id, logical_operation, correlation_id, occurred_at, outcome, evidence)
    VALUES (?, 'discord:owner', 'client-1', 'act_1', 'generation-1', 'execute_campaign_bundle', ?, ?, 'started', '{}')`)
    .run("forged-empty-step-audit", "request-forged-empty-step", now.toISOString());
  assert.throws(() => db.prepare(`INSERT INTO operation_execution_audit_links
    (audit_id, operation_id, decision_id, execution_id, step_key, event_type)
    VALUES ('forged-empty-step-audit', 'operation-1', 'decision-1', 'audit-execution', '', 'meta_call')`).run(), /step|constraint|foreign key/i);
  db.prepare(`INSERT INTO operation_steps
    (execution_id, operation_id, step_key, sequence, kind, status, request_hash, correlation_id, attempted_at)
    VALUES ('audit-execution', 'operation-1', 'media:media-1', 0, 'image', 'intent', ?, 'request-valid-audit-step', ?)`)
    .run("0".repeat(64), now.toISOString());
  db.prepare(`INSERT INTO audit_log
    (id, actor, client_id, ad_account_id, generation_id, logical_operation, correlation_id, occurred_at, outcome, evidence)
    VALUES ('valid-step-audit', 'discord:owner', 'client-1', 'act_1', 'generation-1', 'execute_campaign_bundle',
      'request-valid-step-audit', ?, 'started', '{}')`).run(now.toISOString());
  db.prepare(`INSERT INTO operation_execution_audit_links
    (audit_id, operation_id, decision_id, execution_id, step_key, event_type)
    VALUES ('valid-step-audit', 'operation-1', 'decision-1', 'audit-execution', 'media:media-1', 'meta_call')`).run();
  assert.equal(db.prepare("SELECT step_key FROM operation_execution_audit_links WHERE audit_id = 'valid-step-audit'").get()!.step_key, "media:media-1");
});

test("database permits only the exact singleton step for non-bundle operation types", (t) => {
  const { db } = fixture();
  t.after(() => db.close());
  const operations = [
    ["operation-update-shape", "update_object", { object_type: "campaign", object_id: "campaign-1", changes: { name: "Name" } }, "update_object", "G"],
    ["operation-delivery-shape", "change_delivery", { action: "PAUSE", object_type: "Campaign", object_id: "campaign-1" }, "change_delivery", "H"],
    ["operation-budget-shape", "configure_monthly_budget", { monthly_budget: { amount: "10.00", currency: "USD" } }, "configure_monthly_budget", "I"],
  ] as const;
  for (const [operationId, operationType, payload, expectedStep, nonceByte] of operations) {
    addApprovedOperation(db, operationId, operationType, payload, nonceByte);
    const payloadHash = String(db.prepare("SELECT payload_hash FROM operations WHERE id = ?").get(operationId)!.payload_hash);
    db.prepare(`INSERT INTO operation_executions (id, operation_id, decision_id, payload_hash, status, claimed_at, correlation_id)
      VALUES (?, ?, ?, ?, 'running', ?, ?)`).run(`execution-${operationId}`, operationId, `decision-${operationId}`, payloadHash, now.toISOString(), `request-${operationId}`);
    db.prepare("UPDATE operations SET status = 'executing' WHERE id = ?").run(operationId);
    const insert = db.prepare(`INSERT INTO operation_steps
      (execution_id, operation_id, step_key, sequence, kind, status, request_hash, correlation_id, attempted_at)
      VALUES (?, ?, ?, ?, ?, 'intent', ?, ?, ?)`);
    assert.throws(() => insert.run(`execution-${operationId}`, operationId, "campaign", 0, "campaign", "0".repeat(64), `wrong-${operationId}`, now.toISOString()), /type.*order/i);
    assert.throws(() => insert.run(`execution-${operationId}`, operationId, expectedStep, 1, expectedStep, "0".repeat(64), `skip-${operationId}`, now.toISOString()), /type.*order/i);
    insert.run(`execution-${operationId}`, operationId, expectedStep, 0, expectedStep, "0".repeat(64), `valid-${operationId}`, now.toISOString());
  }
});

test("database rejects untyped campaign result even with complete successful resources", (t) => {
  const { db } = fixture();
  t.after(() => db.close());
  prepareCompleteBundleExecution(db);
  assert.throws(() => db.prepare("UPDATE operations SET status = 'succeeded', result_json = '{}' WHERE id = 'operation-1'").run(), /typed execution result/i);
});

test("database validates every required campaign result field without nullable SQL escape", () => {
  const valid = {
    status: "succeeded", completed_at: now.toISOString(), next_action: "no_action",
    campaign: { object_id: "campaign-1", delivery_status: "PAUSED" },
    ad_set: { object_id: "adset-1", delivery_status: "PAUSED" },
    creative: { object_id: "creative-1", bound: true },
    ad: { object_id: "ad-1", delivery_status: "PAUSED" },
  };
  const missing = [
    "status", "completed_at", "next_action", "campaign", "ad_set", "creative", "ad",
    "campaign.object_id", "campaign.delivery_status", "ad_set.object_id", "ad_set.delivery_status",
    "creative.object_id", "creative.bound", "ad.object_id", "ad.delivery_status",
  ];
  const invalid: object[] = missing.map((path, index) => {
    const value = structuredClone(valid) as Record<string, unknown>;
    const [parent = "", child] = path.split(".");
    if (child === undefined) {
      delete value[parent];
      value[`forged_${index}`] = true;
    } else {
      const nested = value[parent] as Record<string, unknown>;
      delete nested[child];
      nested[`forged_${index}`] = true;
    }
    return value;
  });
  invalid.push(
    { ...valid, status: 1 }, { ...valid, completed_at: 1 }, { ...valid, next_action: 1 },
    { ...valid, campaign: { object_id: 1, delivery_status: "PAUSED" } },
    { ...valid, creative: { object_id: "creative-1", bound: "true" } },
    { ...valid, forged: true }, { ...valid, campaign: { ...valid.campaign, forged: true } },
    { status: "succeeded", completed_at: now.toISOString(), next_action: "no_action" },
  );
  for (const [index, result] of invalid.entries()) {
    const { db } = fixture();
    try {
      prepareCompleteBundleExecution(db, `complete-${index}`);
      assert.throws(() => db.prepare("UPDATE operations SET status = 'succeeded', result_json = ? WHERE id = 'operation-1'").run(JSON.stringify(result)), /typed execution result/i, `invalid campaign result ${index}`);
    } finally {
      db.close();
    }
  }
  const { db } = fixture();
  try {
    prepareCompleteBundleExecution(db, "complete-valid");
    db.prepare("UPDATE operations SET status = 'succeeded', result_json = ? WHERE id = 'operation-1'").run(JSON.stringify(valid));
    assert.equal(db.prepare("SELECT status FROM operation_executions WHERE id = 'complete-valid'").get()!.status, "succeeded");
  } finally {
    db.close();
  }
});

test("database binds every successful bundle result ID to its immutable successful step", () => {
  const valid = {
    status: "succeeded", completed_at: now.toISOString(), next_action: "no_action",
    campaign: { object_id: "campaign-1", delivery_status: "PAUSED" },
    ad_set: { object_id: "adset-1", delivery_status: "PAUSED" },
    creative: { object_id: "creative-1", bound: true },
    ad: { object_id: "ad-1", delivery_status: "PAUSED" },
  };
  const invalid = [
    { ...valid, campaign: { ...valid.campaign, object_id: "forged-campaign" } },
    { ...valid, ad_set: { ...valid.ad_set, object_id: "forged-adset" } },
    { ...valid, creative: { ...valid.creative, object_id: "forged-creative" } },
    { ...valid, ad: { ...valid.ad, object_id: "forged-ad" } },
    { ...valid, campaign: { ...valid.campaign, object_id: "ad-1" }, ad: { ...valid.ad, object_id: "campaign-1" } },
  ];
  for (const [index, result] of invalid.entries()) {
    const { db } = fixture();
    try {
      prepareCompleteBundleExecution(db, `result-id-${index}`);
      assert.throws(() => db.prepare("UPDATE operations SET status = 'succeeded', result_json = ? WHERE id = 'operation-1'").run(JSON.stringify(result)), /typed execution result|resource evidence/i, `forged result ${index}`);
    } finally {
      db.close();
    }
  }
  const { db } = fixture();
  try {
    prepareCompleteBundleExecution(db, "result-id-valid");
    db.prepare("UPDATE operations SET status = 'succeeded', result_json = ? WHERE id = 'operation-1'").run(JSON.stringify(valid));
    assert.equal(db.prepare("SELECT status FROM operation_executions WHERE id = 'result-id-valid'").get()!.status, "succeeded");
  } finally {
    db.close();
  }
});

test("database validates failure result fields and proven-resource item shapes", () => {
  const valid = {
    status: "failed", completed_at: now.toISOString(), failure_code: "meta_error",
    proven_resources: [{ type: "image", id: "image-hash-1" }, { type: "campaign", id: "campaign-1" }], failed_or_ambiguous_step: "ad_set", next_action: "fix_input",
  };
  const invalid: object[] = Object.keys(valid).map((key, index) => {
    const value = structuredClone(valid) as Record<string, unknown>;
    delete value[key];
    value[`forged_${index}`] = true;
    return value;
  });
  invalid.push(
    { ...valid, failure_code: 1 }, { ...valid, proven_resources: {} },
    { ...valid, proven_resources: [{ type: "campaign" }] },
    { ...valid, proven_resources: [{ type: "campaign", forged: true }] },
    { ...valid, proven_resources: [{ id: "campaign-1", forged: true }] },
    { ...valid, proven_resources: [{ type: "campaign", id: "campaign-1", forged: true }] },
    { ...valid, failed_or_ambiguous_step: 1 }, { ...valid, forged: true },
  );
  for (const [index, result] of invalid.entries()) {
    const { db } = fixture();
    try {
      prepareBundleExecutionThroughCampaign(db, `failure-${index}`);
      assert.throws(() => db.prepare("UPDATE operations SET status = 'failed', result_json = ? WHERE id = 'operation-1'").run(JSON.stringify(result)), /typed execution result/i, `invalid failure result ${index}`);
    } finally {
      db.close();
    }
  }
  const { db } = fixture();
  try {
    prepareBundleExecutionThroughCampaign(db, "failure-valid");
    db.prepare("UPDATE operations SET status = 'failed', result_json = ? WHERE id = 'operation-1'").run(JSON.stringify(valid));
    assert.equal(db.prepare("SELECT status FROM operation_executions WHERE id = 'failure-valid'").get()!.status, "failed");
  } finally {
    db.close();
  }
});

test("database binds failed-result resources exactly to this operation's successful steps", () => {
  const valid = {
    status: "failed", completed_at: now.toISOString(), failure_code: "meta_error",
    proven_resources: [{ type: "image", id: "image-hash-1" }, { type: "campaign", id: "campaign-1" }],
    failed_or_ambiguous_step: "ad_set", next_action: "fix_input",
  };
  const invalid = [
    { ...valid, proven_resources: [{ type: "image", id: "forged" }, valid.proven_resources[1]] },
    { ...valid, proven_resources: [{ type: "campaign", id: "image-hash-1" }, { type: "image", id: "campaign-1" }] },
    { ...valid, proven_resources: [valid.proven_resources[0], valid.proven_resources[0]] },
    { ...valid, proven_resources: [valid.proven_resources[0]] },
    { ...valid, proven_resources: [...valid.proven_resources, { type: "ad", id: "foreign-operation-ad" }] },
    { ...valid, proven_resources: [...valid.proven_resources].reverse() },
  ];
  for (const [index, result] of invalid.entries()) {
    const { db } = fixture();
    try {
      prepareBundleExecutionThroughCampaign(db, `failed-evidence-${index}`);
      assert.throws(() => db.prepare("UPDATE operations SET status = 'failed', result_json = ? WHERE id = 'operation-1'").run(JSON.stringify(result)), /typed execution result/i, `invalid persisted projection ${index}`);
    } finally {
      db.close();
    }
  }
  const { db } = fixture();
  try {
    prepareBundleExecutionThroughCampaign(db, "failed-evidence-valid");
    db.prepare("UPDATE operations SET status = 'failed', result_json = ? WHERE id = 'operation-1'").run(JSON.stringify(valid));
    assert.deepEqual(JSON.parse(String(db.prepare("SELECT result_json FROM operations WHERE id = 'operation-1'").get()!.result_json)).proven_resources, valid.proven_resources);
  } finally {
    db.close();
  }
});

test("database forbids every terminal operation transition without exactly one running execution", () => {
  const results = [
    ["succeeded", { status: "succeeded", completed_at: now.toISOString(), next_action: "no_action" }],
    ["failed", { status: "failed", completed_at: now.toISOString(), failure_code: "meta_error", proven_resources: [], failed_or_ambiguous_step: null, next_action: "fix_input" }],
  ] as const;
  for (const [status, result] of results) {
    const { db } = fixture();
    try {
      db.prepare("UPDATE operations SET status = 'executing' WHERE id = 'operation-1'").run();
      assert.throws(() => db.prepare("UPDATE operations SET status = ?, result_json = ? WHERE id = 'operation-1'").run(status, JSON.stringify(result)), /execution|required|complete bundle/i, `${status} without execution`);
      assert.deepEqual({ ...db.prepare("SELECT status, result_json FROM operations WHERE id = 'operation-1'").get()! }, { status: "executing", result_json: null });
    } finally {
      db.close();
    }
  }
});

test("concurrent execution attempts grant exactly one worker the mutation claim", async (t) => {
  const { db } = fixture();
  t.after(() => db.close());
  const calls: string[] = [];
  const responses = [
    { images: { upload: { hash: "image-hash-1" } } }, { id: "campaign-1" }, { id: "adset-1" },
    { id: "creative-1" }, { id: "ad-1" },
  ];
  const execution = createExecutionService({
    db, now: () => now, revalidate: async () => undefined,
    readMedia: async () => ({ contentType: "image/png" as const, bytes: mediaBytes }), cleanupOperationMedia: async () => 1,
    meta: { request: async (request) => { calls.push(request.path); await new Promise((resolve) => setImmediate(resolve)); return { data: responses[calls.length - 1], rate: {} }; } },
  });

  const results = await Promise.all([
    execution.execute({ operationId: "operation-1", actor: "discord:owner", requestId: "request-worker-1" }),
    execution.execute({ operationId: "operation-1", actor: "discord:owner", requestId: "request-worker-2" }),
  ]);

  assert.equal(calls.length, 5);
  assert.equal(db.prepare("SELECT count(*) AS count FROM operation_executions WHERE operation_id = 'operation-1'").get()!.count, 1);
  assert.equal(results.some(({ status }) => status === "succeeded"), true);
});

test("derives an instant-form video bundle without website fields or Creative delivery status", async (t) => {
  const { db } = fixture();
  t.after(() => db.close());
  addApprovedOperation(db, "operation-instant", "create_campaign_bundle", {
    campaign_kind: "LEADS_INSTANT_FORM",
    campaign: { name: "Leads", budget: { kind: "lifetime", value: { amount: "50.00", currency: "USD" } } },
    ad_set: { name: "Lead set", lead_gen_form_id: "form-1", targeting: { countries: ["AR"], minimum_age: 25, maximum_age: 60 } },
    creative: { name: "Lead creative", page_id: "page-1", instagram_account_id: "instagram-1", message: "Contact us", call_to_action: "SIGN_UP", media: [{ media_id: "video-1", sha256: mediaHash }] },
    ad: { name: "Lead ad" },
  }, "E", {
    objective: "OUTCOME_LEADS", destination: "ON_AD", optimization_goal: "LEAD_GENERATION",
    billing_event: "IMPRESSIONS", conversion_event: "LEAD",
  });
  db.prepare(`INSERT INTO staged_media
    (id, client_id, ad_account_id, generation_id, sha256, media_type, content_type, size_bytes,
     original_filename, attachment_id, actor, correlation_id, storage_name, status, created_at, expires_at)
    VALUES ('video-1', 'client-1', 'act_1', 'generation-1', ?, 'video', 'video/mp4', ?,
      'creative.mp4', 'attachment-video', 'openclaw', 'request-video', '00000000-0000-4000-8000-000000000003', 'bound', ?, '2026-08-20T00:00:00.000Z')`)
    .run(mediaHash, mediaBytes.byteLength, now.toISOString());
  db.prepare(`INSERT INTO operation_media (operation_id, media_id, media_hash, client_id, ad_account_id)
    VALUES ('operation-instant', 'video-1', ?, 'client-1', 'act_1')`).run(mediaHash);
  const calls: Array<{ path: string; body?: unknown; form?: FormData }> = [];
  const responses = [{ id: "video-meta-1" }, { id: "campaign-2" }, { id: "adset-2" }, { id: "creative-2" }, { id: "ad-2" }];
  const execution = createExecutionService({
    db, now: () => now, revalidate: async () => undefined,
    readMedia: async () => ({ contentType: "video/mp4" as const, bytes: mediaBytes }), cleanupOperationMedia: async () => 1,
    meta: { request: async (request) => { calls.push({ path: request.path, ...(request.body === undefined ? {} : { body: request.body }), ...(request.form === undefined ? {} : { form: request.form }) }); return { data: responses[calls.length - 1], rate: {} }; } },
  });

  const result = await execution.execute({ operationId: "operation-instant", actor: "discord:owner", requestId: "request-instant" });

  assert.equal(result.status, "succeeded");
  assert.equal(calls[0]!.form instanceof FormData, true);
  assert.equal(calls[0]!.body, undefined);
  assert.deepEqual(calls[2]!.body, {
    name: "Lead set", campaign_id: "campaign-2", billing_event: "IMPRESSIONS", optimization_goal: "LEAD_GENERATION",
    destination_type: "ON_AD", promoted_object: { page_id: "page-1" },
    targeting: { geo_locations: { countries: ["AR"] }, age_min: 25, age_max: 60 }, status: "PAUSED",
  });
  assert.deepEqual((calls[3]!.body as { object_story_spec: { video_data: object } }).object_story_spec.video_data, {
    message: "Contact us", link: "http://fb.me/", call_to_action: { type: "SIGN_UP", value: { lead_gen_form_id: "form-1" } }, video_id: "video-meta-1",
  });
  assert.equal((calls[3]!.body as { object_story_spec: Record<string, unknown> }).object_story_spec.instagram_user_id, "instagram-1");
  assert.equal("instagram_actor_id" in (calls[3]!.body as { object_story_spec: Record<string, unknown> }).object_story_spec, false);
  assert.deepEqual(result.result && "creative" in result.result ? result.result.creative : undefined, { object_id: "creative-2", bound: true });
});

test("executes approved updates, delivery changes, and exact local monthly budgets without duplicate writes", async (t) => {
  const { db } = fixture();
  t.after(() => db.close());
  addApprovedOperation(db, "operation-update", "update_object", {
    object_type: "campaign", object_id: "campaign-9",
    changes: { name: "Renamed", budget: { kind: "daily", value: { amount: "12.34", currency: "USD" } } },
  }, "B");
  addApprovedOperation(db, "operation-delivery", "change_delivery", {
    action: "RESUME", object_type: "Campaign", object_id: "campaign-9",
  }, "C");
  addApprovedOperation(db, "operation-budget", "configure_monthly_budget", {
    monthly_budget: { amount: "123.45", currency: "USD" },
  }, "D");
  const calls: Array<{ path: string; body: unknown }> = [];
  const execution = createExecutionService({
    db, now: () => now, revalidate: async () => undefined,
    readMedia: async () => { throw new Error("media must not be read"); },
    cleanupOperationMedia: async () => 0,
    meta: { request: async (request) => { calls.push({ path: request.path, body: request.body }); return { data: { success: true }, rate: {} }; } },
  });

  for (const operationId of ["operation-update", "operation-delivery", "operation-budget"]) {
    const result = await execution.execute({ operationId, actor: "discord:owner", requestId: `execute-${operationId}` });
    assert.deepEqual(result.result, { status: "succeeded", completed_at: now.toISOString(), next_action: "no_action" });
  }

  assert.deepEqual(calls, [
    { path: "/campaign-9", body: { name: "Renamed", daily_budget: "1234" } },
    { path: "/campaign-9", body: { status: "ACTIVE" } },
  ]);
  assert.deepEqual({ ...db.prepare("SELECT amount_minor, currency FROM budgets WHERE client_id = 'client-1' AND ad_account_id = 'act_1'").get()! }, {
    amount_minor: 12345, currency: "USD",
  });
  assert.equal(db.prepare("SELECT count(*) AS count FROM operation_executions WHERE operation_id IN ('operation-update', 'operation-delivery', 'operation-budget')").get()!.count, 3);
  assert.equal(db.prepare("SELECT count(*) AS count FROM operation_steps WHERE operation_id IN ('operation-update', 'operation-delivery', 'operation-budget')").get()!.count, 3);
});

test("executes a mutation only against its persisted authoritative target", async (t) => {
  const { db } = fixture();
  t.after(() => db.close());
  addApprovedOperation(db, "operation-authoritative", "update_object", {
    object_type: "campaign", object_id: "caller-supplied", changes: { name: "Renamed" },
  }, "J", { target: { object_type: "campaign", object_id: "meta-authoritative", ad_account_id: "act_1" } });
  const paths: string[] = [];
  const execution = createExecutionService({
    db, now: () => now, revalidate: async () => undefined,
    readMedia: async () => { throw new Error("media must not be read"); }, cleanupOperationMedia: async () => 0,
    meta: { request: async (request) => { paths.push(request.path); return { data: { success: true }, rate: {} }; } },
  });

  const result = await execution.execute({ operationId: "operation-authoritative", actor: "discord:owner", requestId: "request-authoritative" });

  assert.equal(result.status, "succeeded");
  assert.deepEqual(paths, ["/meta-authoritative"]);
});

test("startup recovery claims approved operations that have no execution row exactly once", async (t) => {
  const { db } = fixture();
  t.after(() => db.close());
  addApprovedOperation(db, "operation-unclaimed", "configure_monthly_budget", {
    monthly_budget: { amount: "42.42", currency: "USD" },
  }, "K");
  const execution = createExecutionService({
    db, now: () => now, revalidate: async () => undefined,
    readMedia: async () => { throw new Error("media must not be read"); }, cleanupOperationMedia: async () => 0,
    meta: { request: async () => { throw new Error("local budget must not call Meta"); } },
  });

  const first = await execution.reconcile({ actor: "system:recovery", requestId: "startup-recovery" });
  const second = await execution.reconcile({ actor: "system:recovery", requestId: "startup-recovery-replay" });

  assert.equal(first.some(({ operation_id, status }) => operation_id === "operation-unclaimed" && status === "succeeded"), true);
  assert.equal(second.some(({ operation_id }) => operation_id === "operation-unclaimed"), false);
  assert.equal(db.prepare("SELECT count(*) AS count FROM operation_executions WHERE operation_id = 'operation-unclaimed'").get()!.count, 1);
  assert.equal(db.prepare("SELECT correlation_id FROM operation_executions WHERE operation_id = 'operation-unclaimed'").get()!.correlation_id, "request-operation-unclaimed");
  assert.equal(db.prepare("SELECT amount_minor FROM budgets WHERE client_id = 'client-1' AND ad_account_id = 'act_1'").get()!.amount_minor, 4242);
});

test("startup recovery leaves retryable target revalidation pending for a later retry", async (t) => {
  const { db } = fixture();
  t.after(() => db.close());
  const execution = createExecutionService({
    db, now: () => now, revalidate: async () => { throw new MetaError("upstream", "upstream_error", 503, undefined, true); },
    readMedia: async () => { throw new Error("media must not be read"); }, cleanupOperationMedia: async () => { throw new Error("media must not be cleaned"); },
    meta: { request: async () => { throw new Error("Meta write must not run"); } },
  });

  const recovered = await execution.reconcile({ actor: "system:recovery", requestId: "request-transient-recovery" });
  assert.equal(recovered.find(({ operation_id }) => operation_id === "operation-1")!.status, "pending");
  assert.equal(db.prepare("SELECT status FROM operations WHERE id = 'operation-1'").get()!.status, "pending");
  assert.equal(db.prepare("SELECT count(*) AS count FROM operation_executions WHERE operation_id = 'operation-1'").get()!.count, 0);
});

test("reconciles a restart from persisted successful bundle steps without repeating writes", async (t) => {
  const { db } = fixture();
  t.after(() => db.close());
  const firstCalls: string[] = [];
  const first = createExecutionService({
    db, now: () => now,
    revalidate: async () => undefined,
    testHooks: { beforeStepIntent: (stepKey) => { if (stepKey === "ad_set") throw new Error("process stopped before next intent"); } },
    readMedia: async () => ({ contentType: "image/png" as const, bytes: mediaBytes }),
    cleanupOperationMedia: async () => 0,
    meta: { request: async (request) => {
      firstCalls.push(request.path);
      return { data: firstCalls.length === 1 ? { images: { upload: { hash: "image-hash-1" } } } : { id: "campaign-1" }, rate: {} };
    } },
  });
  const interrupted = await first.execute({ operationId: "operation-1", actor: "discord:owner", requestId: "request-before-restart" });
  assert.equal(interrupted.status, "executing");
  assert.deepEqual(firstCalls, ["/act_1/adimages", "/act_1/campaigns"]);

  const resumedCalls: string[] = [];
  const ids = ["adset-1", "creative-1", "ad-1"];
  const restarted = createExecutionService({
    db, now: () => now, revalidate: async () => undefined,
    readMedia: async () => ({ contentType: "image/png" as const, bytes: mediaBytes }),
    cleanupOperationMedia: async () => 1,
    meta: { request: async (request) => { resumedCalls.push(request.path); return { data: { id: ids.shift() }, rate: {} }; } },
  });
  const reconciled = await restarted.reconcile({ actor: "system:recovery", requestId: "request-restart" });

  assert.equal(reconciled.length, 1);
  assert.equal(reconciled[0]!.status, "succeeded");
  assert.deepEqual(resumedCalls, ["/act_1/adsets", "/act_1/adcreatives", "/act_1/ads"]);
  assert.equal(db.prepare("SELECT count(*) AS count FROM operation_steps WHERE operation_id = 'operation-1'").get()!.count, 5);
});

test("reconciles a committed local budget step after a crash before terminal outcome", async (t) => {
  const { db } = fixture();
  t.after(() => db.close());
  addApprovedOperation(db, "operation-local-crash", "configure_monthly_budget", {
    monthly_budget: { amount: "77.77", currency: "USD" },
  }, "F");
  const interrupted = createExecutionService({
    db, now: () => now, revalidate: async () => undefined,
    readMedia: async () => { throw new Error("media must not be read"); }, cleanupOperationMedia: async () => 0,
    meta: { request: async () => { throw new Error("local budget must not call Meta"); } },
    testHooks: { afterLocalStepSuccess: () => { throw new Error("process stopped after local commit"); } },
  });
  const beforeRestart = await interrupted.execute({ operationId: "operation-local-crash", actor: "discord:owner", requestId: "request-local-crash" });
  assert.equal(beforeRestart.status, "executing");
  assert.deepEqual(beforeRestart.result, {
    status: "executing", proven_resources: [{ type: "budget", id: "act_1" }],
    failed_or_ambiguous_step: null, next_action: "wait",
  });
  assert.equal(db.prepare("SELECT status FROM operation_steps WHERE operation_id = 'operation-local-crash'").get()!.status, "succeeded");

  const restarted = createExecutionService({
    db, now: () => now, revalidate: async () => undefined,
    readMedia: async () => { throw new Error("media must not be read"); }, cleanupOperationMedia: async () => 0,
    meta: { request: async () => { throw new Error("local budget must not call Meta"); } },
  });
  const result = await restarted.reconcile({ actor: "system:recovery", requestId: "request-local-recovery" });

  assert.equal(result.find(({ operation_id }) => operation_id === "operation-local-crash")!.status, "succeeded");
  assert.equal(db.prepare("SELECT count(*) AS count FROM operation_steps WHERE operation_id = 'operation-local-crash'").get()!.count, 1);
  assert.equal(db.prepare("SELECT amount_minor FROM budgets WHERE client_id = 'client-1' AND ad_account_id = 'act_1'").get()!.amount_minor, 7777);
  assert.deepEqual(db.prepare(`SELECT DISTINCT a.correlation_id FROM audit_log a
    JOIN operation_execution_audit_links l ON l.audit_id = a.id
    WHERE l.operation_id = 'operation-local-crash'
      AND a.logical_operation IN ('execution_step_intent', 'execution_step_outcome', 'execution_result')`).all()
    .map(({ correlation_id }) => String(correlation_id)), ["request-local-crash"]);
});

test("pauses an ambiguous write across restart and never dispatches it again", async (t) => {
  const { db } = fixture();
  t.after(() => db.close());
  const calls: string[] = [];
  const execution = createExecutionService({
    db, now: () => now, revalidate: async () => undefined,
    readMedia: async () => ({ contentType: "image/png" as const, bytes: mediaBytes }),
    cleanupOperationMedia: async () => 0,
    meta: { request: async (request) => {
      calls.push(request.path);
      if (request.path.endsWith("/campaigns")) throw new Error("connection reset after dispatch");
      return { data: { images: { upload: { hash: "image-hash-1" } } }, rate: {} };
    } },
  });
  const ambiguous = await execution.execute({ operationId: "operation-1", actor: "discord:owner", requestId: "request-ambiguous" });
  assert.equal(ambiguous.status, "executing");
  assert.equal(ambiguous.next_action, "reconcile_manually_no_automatic_replay");
  assert.deepEqual(ambiguous.result, {
    status: "reconciliation_required",
    proven_resources: [{ type: "image", id: "image-hash-1" }],
    failed_or_ambiguous_step: "campaign",
    next_action: "reconcile_manually_no_automatic_replay",
  });
  assert.deepEqual(calls, ["/act_1/adimages", "/act_1/campaigns"]);
  assert.deepEqual({ ...db.prepare("SELECT status, error_code FROM operation_steps WHERE step_key = 'campaign'").get()! }, {
    status: "reconciliation_required", error_code: "ambiguous_write",
  });
  assert.equal(db.prepare("SELECT json_extract(evidence, '$.errorCode') AS code FROM audit_log WHERE logical_operation = 'execute_operation'").get()!.code, "ambiguous_write");

  const restarted = createExecutionService({
    db, now: () => now, revalidate: async () => undefined,
    readMedia: async () => ({ contentType: "image/png" as const, bytes: mediaBytes }), cleanupOperationMedia: async () => 0,
    meta: { request: async () => { throw new Error("ambiguous write must not be retried"); } },
  });
  const reconciled = await restarted.reconcile({ actor: "system:recovery", requestId: "request-reconcile-ambiguous" });
  assert.equal(reconciled[0]!.status, "executing");
  assert.deepEqual(calls, ["/act_1/adimages", "/act_1/campaigns"]);
  assert.equal(db.prepare("SELECT status FROM operation_executions WHERE operation_id = 'operation-1'").get()!.status, "reconciliation_required");
  assert.equal(db.prepare(`SELECT count(*) AS count FROM audit_log
    WHERE logical_operation = 'execution_reconciliation_required' AND correlation_id = 'request-ambiguous'`).get()!.count, 1);
});

test("returns a newly recovered reconciliation-required execution only once", async (t) => {
  const { db } = fixture();
  t.after(() => db.close());
  let calls = 0;
  const execution = createExecutionService({
    db, now: () => now, revalidate: async () => undefined,
    readMedia: async () => ({ contentType: "image/png" as const, bytes: mediaBytes }),
    cleanupOperationMedia: async () => 0,
    meta: { request: async () => {
      calls += 1;
      if (calls === 1) return { data: { images: { upload: { hash: "image-hash-1" } } }, rate: {} };
      throw new MetaError("timeout", "timeout");
    } },
  });

  const reconciled = await execution.reconcile({ actor: "system:recovery", requestId: "request-recovery" });

  assert.equal(reconciled.filter(({ operation_id }) => operation_id === "operation-1").length, 1);
  assert.equal(reconciled.find(({ operation_id }) => operation_id === "operation-1")!.result?.status, "reconciliation_required");
});

test("marks an approved operation stale when execution-time revalidation changes after claim", async (t) => {
  const { db } = fixture();
  t.after(() => db.close());
  let checks = 0;
  let cleanupStatus: string | undefined;
  let dispatched = false;
  const execution = createExecutionService({
    db, now: () => now,
    revalidate: async () => {
      checks += 1;
      if (checks === 2) {
        db.prepare("UPDATE scope_mappings SET active = 0 WHERE client_id = 'client-1' AND ad_account_id = 'act_1'").run();
        throw new OperationError("authority changed", 409, "operation_stale");
      }
    },
    readMedia: async () => ({ contentType: "image/png" as const, bytes: mediaBytes }),
    cleanupOperationMedia: async (_operationId, status) => { cleanupStatus = status; return 1; },
    meta: { request: async () => { dispatched = true; return { data: {}, rate: {} }; } },
  });

  const result = await execution.execute({ operationId: "operation-1", actor: "discord:owner", requestId: "request-stale-after-claim" });

  assert.equal(result.status, "stale");
  assert.equal(result.next_action, "retry_new_operation");
  assert.equal(dispatched, false);
  assert.equal(cleanupStatus, "invalid");
  assert.equal(db.prepare("SELECT status FROM operation_executions WHERE operation_id = 'operation-1'").get()!.status, "failed");
});

test("retryable revalidation after claim resumes safely before any Meta write", async (t) => {
  const { db } = fixture();
  t.after(() => db.close());
  let checks = 0;
  let writes = 0;
  const responses = [
    { images: { upload: { hash: "image-hash-1" } } }, { id: "campaign-1" }, { id: "adset-1" }, { id: "creative-1" }, { id: "ad-1" },
  ];
  const execution = createExecutionService({
    db, now: () => now, revalidate: async () => {
      checks += 1;
      if (checks === 2) throw new MetaError("limited", "meta_4", 400, 9, true);
    },
    readMedia: async () => ({ contentType: "image/png" as const, bytes: mediaBytes }), cleanupOperationMedia: async () => 0,
    meta: { request: async () => ({ data: responses[writes++]!, rate: {} }) },
  });

  await assert.rejects(execution.execute({ operationId: "operation-1", actor: "discord:owner", requestId: "request-transient-execution" }), MetaError);
  assert.equal(db.prepare("SELECT status FROM operations WHERE id = 'operation-1'").get()!.status, "executing");
  assert.equal(db.prepare("SELECT count(*) AS count FROM operation_executions WHERE operation_id = 'operation-1'").get()!.count, 1);
  assert.equal(db.prepare("SELECT count(*) AS count FROM operation_steps WHERE operation_id = 'operation-1'").get()!.count, 0);
  assert.equal(writes, 0);

  const retried = await execution.execute({ operationId: "operation-1", actor: "discord:owner", requestId: "request-transient-execution-retry" });
  assert.equal(retried.status, "succeeded");
  assert.equal(writes, 5);
});

test("startup recovery retries a claimed zero-step execution after upstream revalidation recovers", async (t) => {
  const { db } = fixture();
  t.after(() => db.close());
  addApprovedOperation(db, "operation-recovery-revalidation", "configure_monthly_budget", {
    monthly_budget: { amount: "54.32", currency: "USD" },
  }, "L");
  const hash = String(db.prepare("SELECT payload_hash FROM operations WHERE id = 'operation-recovery-revalidation'").get()!.payload_hash);
  db.prepare(`INSERT INTO operation_executions
    (id, operation_id, decision_id, payload_hash, status, claimed_at, correlation_id)
    VALUES ('execution-recovery-revalidation', 'operation-recovery-revalidation', 'decision-operation-recovery-revalidation', ?, 'running', ?, 'request-recovery-revalidation')`)
    .run(hash, now.toISOString());
  db.prepare("UPDATE operations SET status = 'executing' WHERE id = 'operation-recovery-revalidation'").run();
  let failedOnce = false;
  const execution = createExecutionService({
    db, now: () => now, revalidate: async ({ operationId }) => {
      if (operationId === "operation-recovery-revalidation" && !failedOnce) {
        failedOnce = true;
        throw new MetaError("invalid response", "invalid_response", 404);
      }
    },
    readMedia: async () => { throw new Error("media must not be read"); }, cleanupOperationMedia: async () => 0,
    meta: { request: async () => { throw new Error("local budget must not call Meta"); } },
  });

  const failed = await execution.reconcile({ actor: "system:recovery", requestId: "startup-recovery" });
  assert.equal(failed.find(({ operation_id }) => operation_id === "operation-recovery-revalidation")!.status, "executing");
  assert.equal(db.prepare("SELECT count(*) AS count FROM operation_steps WHERE operation_id = 'operation-recovery-revalidation'").get()!.count, 0);

  const retried = await execution.reconcile({ actor: "system:recovery", requestId: "startup-recovery-retry" });
  assert.equal(retried.find(({ operation_id }) => operation_id === "operation-recovery-revalidation")!.status, "succeeded");
  assert.equal(db.prepare("SELECT amount_minor FROM budgets WHERE client_id = 'client-1' AND ad_account_id = 'act_1'").get()!.amount_minor, 5432);
});

test("cleans bound media after a definitive campaign failure and keeps ambiguous media", async (t) => {
  for (const [kind, error, expectedCleanup] of [
    ["definitive", new MetaError("rejected", "meta_100", 400), "invalid"],
    ["ambiguous", new MetaError("timeout", "timeout"), undefined],
  ] as const) {
    const { db } = fixture();
    t.after(() => db.close());
    const cleanup: string[] = [];
    let calls = 0;
    const execution = createExecutionService({
      db, now: () => now, revalidate: async () => undefined,
      readMedia: async () => ({ contentType: "image/png" as const, bytes: mediaBytes }),
      cleanupOperationMedia: async (_operationId, status) => { cleanup.push(status); return 1; },
      meta: { request: async () => {
        calls += 1;
        if (calls === 1) return { data: { images: { upload: { hash: "image-hash-1" } } }, rate: {} };
        throw error;
      } },
    });

    const result = await execution.execute({ operationId: "operation-1", actor: "discord:owner", requestId: `request-${kind}` });
    assert.equal(result.status, kind === "definitive" ? "failed" : "executing");
    assert.deepEqual(result.result, kind === "definitive" ? {
      status: "failed",
      completed_at: now.toISOString(),
      failure_code: "meta_error",
      proven_resources: [{ type: "image", id: "image-hash-1" }],
      failed_or_ambiguous_step: "campaign",
      next_action: "fix_input",
    } : {
      status: "reconciliation_required",
      proven_resources: [{ type: "image", id: "image-hash-1" }],
      failed_or_ambiguous_step: "campaign",
      next_action: "reconcile_manually_no_automatic_replay",
    });
    assert.deepEqual(cleanup, expectedCleanup === undefined ? [] : [expectedCleanup]);
  }
});

test("expires an approved operation if execution reaches the exact deadline before claim", async (t) => {
  const { db } = fixture();
  t.after(() => db.close());
  let cleanupStatus: string | undefined;
  const execution = createExecutionService({
    db, now: () => new Date("2026-08-20T00:00:00.000Z"), revalidate: async () => undefined,
    readMedia: async () => { throw new Error("expired media must not be read"); },
    cleanupOperationMedia: async (_operationId, status) => { cleanupStatus = status; return 1; },
    meta: { request: async () => { throw new Error("expired operation must not reach Meta"); } },
  });

  const result = await execution.execute({ operationId: "operation-1", actor: "discord:owner", requestId: "request-expired-execution" });

  assert.equal(result.status, "expired");
  assert.equal(cleanupStatus, "expired");
  assert.equal(db.prepare("SELECT count(*) AS count FROM operation_executions").get()!.count, 0);
});

test("fails closed with media_invalid when bound bytes disappear after claim but before upload", async (t) => {
  const { db } = fixture();
  t.after(() => db.close());
  let cleanupStatus: string | undefined;
  let dispatched = false;
  const execution = createExecutionService({
    db, now: () => now, revalidate: async () => undefined,
    readMedia: async () => { throw new Error("bound media changed"); },
    cleanupOperationMedia: async (_operationId, status) => { cleanupStatus = status; return 1; },
    meta: { request: async () => { dispatched = true; return { data: {}, rate: {} }; } },
  });

  const result = await execution.execute({ operationId: "operation-1", actor: "discord:owner", requestId: "request-media-race" });

  assert.deepEqual(result.result, {
    status: "failed", completed_at: now.toISOString(), failure_code: "media_invalid",
    proven_resources: [], failed_or_ambiguous_step: "media:media-1", next_action: "fix_input",
  });
  assert.equal(dispatched, false);
  assert.equal(cleanupStatus, "invalid");
  assert.equal(db.prepare("SELECT status FROM operation_executions WHERE operation_id = 'operation-1'").get()!.status, "failed");
});
