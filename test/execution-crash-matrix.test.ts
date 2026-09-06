import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { openDatabase } from "../src/db.js";
import { MetaError } from "../src/meta-client.js";
import { canonicalPayload, createExecutionService } from "../src/operations.js";

const now = new Date("2026-08-19T12:00:00.000Z");
const bytes = Buffer.from("trusted-image");
const mediaHash = createHash("sha256").update(bytes).digest("hex");
const steps = ["media:media-1", "campaign", "ad_set", "creative", "ad"] as const;
const points = ["before_intent", "after_intent", "timeout", "after_response", "after_persistence"] as const;
const resources = [
  { type: "image", id: "image-hash-1" },
  { type: "campaign", id: "campaign-1" },
  { type: "ad_set", id: "adset-1" },
  { type: "creative", id: "creative-1" },
  { type: "ad", id: "ad-1" },
] as const;

function seed(path: string, root: string) {
  const db = openDatabase(path, root);
  const payload = {
    campaign_kind: "SALES_WEBSITE",
    campaign: { name: "Sales", budget: { kind: "daily", value: { amount: "10.00", currency: "USD" } } },
    ad_set: { name: "Sales set", pixel_id: "pixel-1", targeting: { countries: ["US"], minimum_age: 21, maximum_age: 55 } },
    creative: { name: "Creative", page_id: "page-1", message: "Buy", website_url: "https://example.com", call_to_action: "SHOP_NOW", media: [{ media_id: "media-1", sha256: mediaHash }] },
    ad: { name: "Ad" },
  };
  const payloadJson = canonicalPayload(payload);
  const payloadHash = createHash("sha256").update(payloadJson).digest("hex");
  db.exec(`
    INSERT INTO clients VALUES ('client-1', 'Client', 'portfolio-1', 1);
    INSERT INTO integrations VALUES ('integration-1', 'App', 'app-1', 'active', 1);
    INSERT INTO integration_generations (id, integration_id, generation, status, validated_at) VALUES ('generation-1', 'integration-1', '1', 'active', '${now.toISOString()}');
    INSERT INTO ad_accounts (id, client_id, name, currency, timezone) VALUES ('act_1', 'client-1', 'Account', 'USD', 'UTC');
    INSERT INTO scope_mappings VALUES ('client-1', 'act_1', 'generation-1', 1, 1, 1, 1, 1, '["ADVERTISE"]');
    INSERT INTO encrypted_credentials (id, generation_id, subject_id, key_ref, envelope_version, ciphertext, iv, auth_tag, scopes, status, validated_at)
      VALUES ('credential-1', 'generation-1', 'subject', 'key', 1, 'cipher', 'iv', 'tag', '["ads_management"]', 'active', '${now.toISOString()}');
  `);
  db.prepare(`INSERT INTO operations
    (id, actor, client_id, ad_account_id, generation_id, operation_type, payload_json, payload_hash, derived_json, status, created_at, expires_at)
    VALUES ('operation-1', 'openclaw', 'client-1', 'act_1', 'generation-1', 'create_campaign_bundle', ?, ?, ?, 'pending', ?, '2026-08-20T00:00:00.000Z')`)
    .run(payloadJson, payloadHash, canonicalPayload({ objective: "OUTCOME_SALES", destination: "WEBSITE", optimization_goal: "OFFSITE_CONVERSIONS", billing_event: "IMPRESSIONS", conversion_event: "PURCHASE" }), now.toISOString());
  db.prepare(`INSERT INTO staged_media
    (id, client_id, ad_account_id, generation_id, sha256, media_type, content_type, size_bytes, original_filename,
     attachment_id, actor, correlation_id, storage_name, status, created_at, expires_at)
    VALUES ('media-1', 'client-1', 'act_1', 'generation-1', ?, 'image', 'image/png', ?, 'creative.png',
      'attachment-1', 'openclaw', 'request-media', '00000000-0000-4000-8000-000000000001', 'bound', ?, '2026-08-20T00:00:00.000Z')`)
    .run(mediaHash, bytes.byteLength, now.toISOString());
  db.prepare(`INSERT INTO operation_media (operation_id, media_id, media_hash, client_id, ad_account_id)
    VALUES ('operation-1', 'media-1', ?, 'client-1', 'act_1')`).run(mediaHash);
  db.prepare(`INSERT INTO proof_nonces (nonce, owner_identity, operation_id, decision, body_hash, issued_at, consumed_at, correlation_id, purge_after)
    VALUES ('AAAAAAAAAAAAAAAAAAAAAA', 'discord:owner', 'operation-1', 'approved', ?, 1, ?, 'request-approval', 301)`).run("0".repeat(64), now.toISOString());
  db.prepare(`INSERT INTO approval_decisions (id, operation_id, payload_hash, decision, owner_identity, decided_at, nonce, correlation_id)
    VALUES ('decision-1', 'operation-1', ?, 'approved', 'discord:owner', ?, 'AAAAAAAAAAAAAAAAAAAAAA', 'request-approval')`).run(payloadHash, now.toISOString());
  return db;
}

function response(path: string): unknown {
  if (path.endsWith("/adimages")) return { images: { upload: { hash: "image-hash-1" } } };
  if (path.endsWith("/campaigns")) return { id: "campaign-1" };
  if (path.endsWith("/adsets")) return { id: "adset-1" };
  if (path.endsWith("/adcreatives")) return { id: "creative-1" };
  return { id: "ad-1" };
}

test("file-backed crash matrix never replays ambiguous writes and resumes only proven steps", async () => {
  const provenPrefixLengths = new Set<number>();
  let combinations = 0;
  for (const stepKey of steps) {
    for (const point of points) {
      combinations += 1;
      const root = await mkdtemp(join(tmpdir(), "fb-execution-crash-"));
      const path = join(root, "state.sqlite");
      try {
        let db = seed(path, root);
        const firstCalls: string[] = [];
        let lookupCalls = 0;
        let destructiveCalls = 0;
        const crash = () => { throw new Error(`crash:${stepKey}:${point}`); };
        const service = createExecutionService({
          db, now: () => now, revalidate: async () => undefined,
          readMedia: async () => ({ contentType: "image/png" as const, bytes }), cleanupOperationMedia: async () => 0,
          testHooks: {
            beforeStepIntent: (current: string) => { if (current === stepKey && point === "before_intent") crash(); },
            afterStepIntent: (current: string) => { if (current === stepKey && point === "after_intent") crash(); },
            afterMetaResponse: (current: string) => { if (current === stepKey && point === "after_response") crash(); },
            afterStepSuccess: (current: string) => { if (current === stepKey && point === "after_persistence") crash(); },
          } as never,
          meta: { request: async (request) => {
            if (request.method === "GET") lookupCalls += 1;
            if (String(request.method) === "DELETE" || /delete|disable/i.test(request.path)) destructiveCalls += 1;
            firstCalls.push(request.path);
            const current = steps[firstCalls.length - 1]!;
            if (current === stepKey && point === "timeout") throw new MetaError("timeout", "timeout");
            return { data: response(request.path), rate: {} };
          } },
        });
        const interrupted = await service.execute({ operationId: "operation-1", actor: "discord:owner", requestId: "request-crash-matrix" });
        const stepIndex = steps.indexOf(stepKey);
        const ambiguous = point === "after_intent" || point === "timeout" || point === "after_response";
        const prefixLength = stepIndex + (point === "after_persistence" ? 1 : 0);
        provenPrefixLengths.add(prefixLength);
        assert.equal(interrupted.next_action, ambiguous ? "reconcile_manually_no_automatic_replay" : "wait", `${stepKey}:${point}: interrupted next action`);
        assert.deepEqual(interrupted.result, {
          status: ambiguous ? "reconciliation_required" : "executing",
          proven_resources: resources.slice(0, prefixLength),
          failed_or_ambiguous_step: ambiguous ? stepKey : null,
          next_action: ambiguous ? "reconcile_manually_no_automatic_replay" : "wait",
        }, `${stepKey}:${point}: interrupted evidence`);
        db.close();

        db = openDatabase(path, root);
        const resumedCalls: string[] = [];
        const restarted = createExecutionService({
          db, now: () => now, revalidate: async () => undefined,
          readMedia: async () => ({ contentType: "image/png" as const, bytes }), cleanupOperationMedia: async () => 0,
          meta: { request: async (request) => {
            if (request.method === "GET") lookupCalls += 1;
            if (String(request.method) === "DELETE" || /delete|disable/i.test(request.path)) destructiveCalls += 1;
            resumedCalls.push(request.path);
            return { data: response(request.path), rate: {} };
          } },
        });
        const [result] = await restarted.reconcile({ actor: "system:recovery", requestId: `startup-recovery-${stepKey}-${point}` });
        assert.equal(result!.status, ambiguous ? "executing" : "succeeded", `${stepKey}:${point}`);
        assert.equal(result!.next_action, ambiguous ? "reconcile_manually_no_automatic_replay" : "no_action", `${stepKey}:${point}`);
        if (ambiguous) assert.deepEqual(result!.result, {
          status: "reconciliation_required",
          proven_resources: resources.slice(0, prefixLength),
          failed_or_ambiguous_step: stepKey,
          next_action: "reconcile_manually_no_automatic_replay",
        }, `${stepKey}:${point}: reopened evidence`);
        else assert.deepEqual(result!.result, {
          status: "succeeded", completed_at: now.toISOString(),
          campaign: { object_id: "campaign-1", delivery_status: "PAUSED" },
          ad_set: { object_id: "adset-1", delivery_status: "PAUSED" },
          creative: { object_id: "creative-1", bound: true },
          ad: { object_id: "ad-1", delivery_status: "PAUSED" }, next_action: "no_action",
        }, `${stepKey}:${point}: completed evidence`);
        assert.equal(resumedCalls.some((pathValue) => firstCalls.includes(pathValue)), false, `${stepKey}:${point}: redispatch after reopen`);
        if (ambiguous) assert.equal(resumedCalls.length, 0, `${stepKey}:${point}: ambiguous dispatch`);
        assert.equal(lookupCalls, 0, `${stepKey}:${point}: name lookup`);
        assert.equal(destructiveCalls, 0, `${stepKey}:${point}: destructive compensation`);
        assert.deepEqual(db.prepare("SELECT DISTINCT correlation_id FROM operation_steps WHERE operation_id = 'operation-1'").all().map(({ correlation_id }) => String(correlation_id)), ["request-crash-matrix"]);
        db.close();
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  }
  assert.equal(combinations, 25);
  assert.equal(provenPrefixLengths.has(2), true);
  assert.equal(provenPrefixLengths.has(4), true);
});
