import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import test from "node:test";
import { openDatabase } from "../src/db.js";
import { createMetaClient } from "../src/meta-client.js";
import { canonicalPayload, createExecutionService } from "../src/operations.js";

const now = new Date("2026-08-19T12:00:00.000Z");
const bytes = Buffer.from("trusted-media");
const sha256 = createHash("sha256").update(bytes).digest("hex");

function setup() {
  const db = openDatabase(":memory:");
  db.exec(`
    INSERT INTO clients VALUES ('client-1', 'Client', 'portfolio-1', 1);
    INSERT INTO integrations VALUES ('integration-1', 'App', 'app-1', 'active', 1);
    INSERT INTO integration_generations (id, integration_id, generation, status, validated_at) VALUES ('generation-1', 'integration-1', '1', 'active', '${now.toISOString()}');
    INSERT INTO ad_accounts (id, client_id, name, currency, timezone) VALUES ('act_1', 'client-1', 'Account', 'USD', 'UTC');
    INSERT INTO scope_mappings VALUES ('client-1', 'act_1', 'generation-1', 1, 1, 1, 1, 1, '["ADVERTISE"]');
    INSERT INTO encrypted_credentials (id, generation_id, subject_id, key_ref, envelope_version, ciphertext, iv, auth_tag, scopes, status, validated_at)
      VALUES ('credential-1', 'generation-1', 'subject', 'key', 1, 'cipher', 'iv', 'tag', '["ads_management"]', 'active', '${now.toISOString()}');
  `);
  return db;
}

function approve(db: ReturnType<typeof openDatabase>, index: number, kind: "SALES_WEBSITE" | "LEADS_WEBSITE" | "LEADS_INSTANT_FORM") {
  const instant = kind === "LEADS_INSTANT_FORM";
  const payload = {
    campaign_kind: kind,
    campaign: { name: `${kind} campaign`, budget: { kind: "daily", value: { amount: "10.00", currency: "USD" } } },
    ad_set: { name: `${kind} set`, ...(instant ? { lead_gen_form_id: "form-1" } : { pixel_id: "pixel-1" }), targeting: { countries: ["US"], minimum_age: 21, maximum_age: 55 } },
    creative: { name: `${kind} creative`, page_id: "page-1", instagram_account_id: "instagram-1", message: "Message", ...(instant ? {} : { website_url: "https://example.com" }), call_to_action: instant ? "SIGN_UP" : kind === "SALES_WEBSITE" ? "SHOP_NOW" : "GET_QUOTE", media: [{ media_id: `media-${index}`, sha256 }] },
    ad: { name: `${kind} ad` },
  };
  const derived = kind === "SALES_WEBSITE"
    ? { objective: "OUTCOME_SALES", destination: "WEBSITE", optimization_goal: "OFFSITE_CONVERSIONS", billing_event: "IMPRESSIONS", conversion_event: "PURCHASE" }
    : kind === "LEADS_WEBSITE"
      ? { objective: "OUTCOME_LEADS", destination: "WEBSITE", optimization_goal: "OFFSITE_CONVERSIONS", billing_event: "IMPRESSIONS", conversion_event: "LEAD" }
      : { objective: "OUTCOME_LEADS", destination: "ON_AD", optimization_goal: "LEAD_GENERATION", billing_event: "IMPRESSIONS", conversion_event: "LEAD" };
  const payloadJson = canonicalPayload(payload);
  const payloadHash = createHash("sha256").update(payloadJson).digest("hex");
  const id = `operation-${index}`;
  const nonce = String(index).repeat(22);
  db.prepare(`INSERT INTO operations
    (id, actor, client_id, ad_account_id, generation_id, operation_type, payload_json, payload_hash, derived_json, status, created_at, expires_at)
    VALUES (?, 'openclaw', 'client-1', 'act_1', 'generation-1', 'create_campaign_bundle', ?, ?, ?, 'pending', ?, '2026-08-20T00:00:00.000Z')`)
    .run(id, payloadJson, payloadHash, canonicalPayload(derived), now.toISOString());
  db.prepare(`INSERT INTO staged_media
    (id, client_id, ad_account_id, generation_id, sha256, media_type, content_type, size_bytes, original_filename,
     attachment_id, actor, correlation_id, storage_name, status, created_at, expires_at)
    VALUES (?, 'client-1', 'act_1', 'generation-1', ?, ?, ?, ?, ?, ?, 'openclaw', ?, ?, 'bound', ?, '2026-08-20T00:00:00.000Z')`)
    .run(`media-${index}`, sha256, instant ? "video" : "image", instant ? "video/mp4" : "image/png", bytes.byteLength,
      instant ? "creative.mp4" : "creative.png", `attachment-${index}`, `request-media-${index}`,
      `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`, now.toISOString());
  db.prepare(`INSERT INTO operation_media (operation_id, media_id, media_hash, client_id, ad_account_id)
    VALUES (?, ?, ?, 'client-1', 'act_1')`).run(id, `media-${index}`, sha256);
  db.prepare(`INSERT INTO proof_nonces (nonce, owner_identity, operation_id, decision, body_hash, issued_at, consumed_at, correlation_id, purge_after)
    VALUES (?, 'discord:owner', ?, 'approved', ?, 1, ?, ?, 301)`).run(nonce, id, "0".repeat(64), now.toISOString(), `request-${index}`);
  db.prepare(`INSERT INTO approval_decisions (id, operation_id, payload_hash, decision, owner_identity, decided_at, nonce, correlation_id)
    VALUES (?, ?, ?, 'approved', 'discord:owner', ?, ?, ?)`).run(`decision-${index}`, id, payloadHash, now.toISOString(), nonce, `request-${index}`);
  return id;
}

test("all campaign kinds use documented v26 multipart wire formats without URL credential leakage", async (t) => {
  const db = setup();
  t.after(() => db.close());
  const calls: Array<{ url: URL; headers: Headers; form: FormData }> = [];
  const meta = createMetaClient({
    fetch: async (input, init) => {
      const url = new URL(String(input));
      assert.ok(init?.body instanceof FormData);
      calls.push({ url, headers: new Headers(init.headers), form: init.body });
      const path = url.pathname;
      if (path.endsWith("/adimages")) return Response.json({ images: { upload: { hash: "image-hash" } } });
      if (path.endsWith("/advideos")) return Response.json({ id: "video-id" });
      if (path.endsWith("/campaigns")) return Response.json({ id: `campaign-${calls.length}` });
      if (path.endsWith("/adsets")) return Response.json({ id: `adset-${calls.length}` });
      if (path.endsWith("/adcreatives")) return Response.json({ id: `creative-${calls.length}` });
      return Response.json({ id: `ad-${calls.length}` });
    },
    getCredentials: async () => ({ accessToken: "TOKEN-CANARY", appSecret: "SECRET-CANARY" }),
    audit: () => undefined,
    now: () => now,
  });
  const execution = createExecutionService({
    db, meta, now: () => now, revalidate: async () => undefined,
    readMedia: async ({ mediaId }) => ({ contentType: mediaId === "media-3" ? "video/mp4" as const : "image/png" as const, bytes }),
    cleanupOperationMedia: async () => 1,
  });

  for (const [index, kind] of ["SALES_WEBSITE", "LEADS_WEBSITE", "LEADS_INSTANT_FORM"].entries()) {
    await execution.execute({ operationId: approve(db, index + 1, kind as "SALES_WEBSITE" | "LEADS_WEBSITE" | "LEADS_INSTANT_FORM"), actor: "discord:owner", requestId: `request-wire-${index + 1}` });
  }

  assert.deepEqual(calls.map(({ url }) => url.pathname.replace("/v26.0", "")), [
    "/act_1/adimages", "/act_1/campaigns", "/act_1/adsets", "/act_1/adcreatives", "/act_1/ads",
    "/act_1/adimages", "/act_1/campaigns", "/act_1/adsets", "/act_1/adcreatives", "/act_1/ads",
    "/act_1/advideos", "/act_1/campaigns", "/act_1/adsets", "/act_1/adcreatives", "/act_1/ads",
  ]);
  const proof = createHmac("sha256", "SECRET-CANARY").update("TOKEN-CANARY").digest("hex");
  for (const call of calls) {
    assert.equal(call.url.origin, "https://graph.facebook.com");
    assert.equal(call.url.searchParams.size, 0);
    assert.equal(call.headers.get("authorization"), "Bearer TOKEN-CANARY");
    assert.equal(call.form.get("appsecret_proof"), proof);
    assert.equal(call.form.get("access_token"), null);
  }
  for (const upload of [calls[0]!, calls[5]!, calls[10]!]) {
    const source = upload.form.get("source");
    assert.ok(source instanceof File);
    assert.match(source.name, /^media-[123]\.(?:png|mp4)$/);
  }
  const salesCreative = JSON.parse(String(calls[3]!.form.get("object_story_spec"))) as Record<string, unknown>;
  assert.equal(salesCreative.instagram_user_id, "instagram-1");
  assert.equal("instagram_actor_id" in salesCreative, false);
  const instantCreative = JSON.parse(String(calls[13]!.form.get("object_story_spec"))) as { video_data: { link: string; call_to_action: { value: { lead_gen_form_id: string } } } };
  assert.equal(instantCreative.video_data.link, "http://fb.me/");
  assert.equal(instantCreative.video_data.call_to_action.value.lead_gen_form_id, "form-1");
  assert.deepEqual(calls.filter(({ url }) => /campaigns$|adsets$|ads$/.test(url.pathname)).map(({ form }) => form.get("status")), ["PAUSED", "PAUSED", "PAUSED", "PAUSED", "PAUSED", "PAUSED", "PAUSED", "PAUSED", "PAUSED"]);
});

test("all campaign kinds normalize definitive Meta wire errors without replay", async (t) => {
  const db = setup();
  t.after(() => db.close());
  let calls = 0;
  const meta = createMetaClient({
    fetch: async () => {
      calls += 1;
      return Response.json({ error: { message: "invalid media", type: "OAuthException", code: 100, fbtrace_id: "trace-secret" } }, { status: 400 });
    },
    getCredentials: async () => ({ accessToken: "TOKEN-CANARY", appSecret: "SECRET-CANARY" }),
    audit: () => undefined,
    now: () => now,
  });
  const execution = createExecutionService({
    db, meta, now: () => now, revalidate: async () => undefined,
    readMedia: async ({ mediaId }) => ({ contentType: mediaId === "media-6" ? "video/mp4" as const : "image/png" as const, bytes }),
    cleanupOperationMedia: async () => 1,
  });

  for (const [index, kind] of ["SALES_WEBSITE", "LEADS_WEBSITE", "LEADS_INSTANT_FORM"].entries()) {
    const operation = await execution.execute({
      operationId: approve(db, index + 4, kind as "SALES_WEBSITE" | "LEADS_WEBSITE" | "LEADS_INSTANT_FORM"),
      actor: "discord:owner",
      requestId: `request-wire-error-${index + 1}`,
    });
    assert.equal(operation.status, "failed");
    assert.equal(operation.next_action, "fix_input");
    assert.equal((operation.result as { failure_code: string }).failure_code, "meta_error");
  }

  assert.equal(calls, 3);
  assert.equal(db.prepare("SELECT count(*) AS count FROM operation_steps WHERE status = 'failed' AND error_code = 'meta_100'").get()!.count, 3);
  assert.equal(db.prepare("SELECT evidence LIKE '%invalid media%' OR evidence LIKE '%trace-secret%' AS leaked FROM audit_log").all().some(({ leaked }) => leaked === 1), false);
});
