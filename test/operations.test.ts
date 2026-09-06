import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { buildApp } from "../src/app.js";
import { openDatabase } from "../src/db.js";
import { createMediaService } from "../src/media.js";
import { canonicalPayload, createOperationHandlers, createOperationsService, OperationError } from "../src/operations.js";
import type { components } from "../src/generated/openapi.js";

const now = new Date("2026-08-19T12:00:00.000Z");
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
type CreateRequest = components["schemas"]["CreateOperationRequest"];
type CampaignRequest = Extract<CreateRequest, { type: "create_campaign_bundle" }>;

function seed(db: ReturnType<typeof openDatabase>) {
  db.exec(`
    INSERT INTO clients (id, name, portfolio_id) VALUES ('client-1', 'Client One', 'portfolio-1');
    INSERT INTO integrations (id, name, meta_app_id, state) VALUES ('integration-1', 'App', 'app-1', 'active');
    INSERT INTO integration_generations (id, integration_id, generation, status, validated_at)
      VALUES ('generation-1', 'integration-1', '2026-08', 'active', '${now.toISOString()}');
    INSERT INTO ad_accounts (id, client_id, name, currency, timezone)
      VALUES ('act_1', 'client-1', 'Account One', 'USD', 'America/New_York');
    INSERT INTO ad_accounts (id, client_id, name, currency, timezone)
      VALUES ('act_2', 'client-1', 'Account Two', 'USD', 'America/New_York');
    INSERT INTO scope_mappings
      (client_id, ad_account_id, generation_id, active, app_authorized, subject_authorized, partner_authorized, asset_authorized, granted_tasks)
      VALUES ('client-1', 'act_1', 'generation-1', 1, 1, 1, 1, 1, '["ADVERTISE"]');
    INSERT INTO scope_mappings
      (client_id, ad_account_id, generation_id, active, app_authorized, subject_authorized, partner_authorized, asset_authorized, granted_tasks)
      VALUES ('client-1', 'act_2', 'generation-1', 1, 1, 1, 1, 1, '["ADVERTISE"]');
    INSERT INTO encrypted_credentials
      (id, generation_id, subject_id, key_ref, envelope_version, ciphertext, iv, auth_tag, scopes, status, validated_at)
      VALUES ('credential-1', 'generation-1', 'subject-1', 'key', 1, 'cipher', 'iv', 'tag',
        '["ads_read","ads_management","pages_read_engagement","leads_retrieval","instagram_basic"]', 'active', '${now.toISOString()}');
  `);
}

async function fixture(t: TestContext, options: { validateTarget?: boolean; formPage?: string; formPublished?: boolean; formUsable?: boolean; omitFormState?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), "fb-marketing-server-operations-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const db = openDatabase(":memory:");
  t.after(() => db.close());
  seed(db);
  const mediaRoot = join(root, "media");
  const media = await createMediaService({ db, dataRoot: root, mediaRoot, now: () => now });
  let sequence = 0;
  const stage = () => media.stage({
      actor: "openclaw:user-1",
      requestId: `request-stage-operation-${++sequence}`,
      clientId: "client-1",
      adAccountId: "act_1",
      attachment: { source: "openclaw_chat_attachment", attachment_id: `attachment-${sequence}`, original_filename: "creative.png", declared_content_type: "image/png" },
      declaredFileType: "image/png",
      bytes: (async function* () { yield png; })(),
    });
  const staged = await stage();
  let current = now;
  const operations = createOperationsService({
    db,
    hashMediaFile: media.hashFile,
    capabilities: async () => ({
      assets: [
        { asset_type: "page", page_id: "page-1", name: "Page" },
        { asset_type: "pixel", pixel_id: "pixel-1", name: "Pixel" },
        { asset_type: "lead_form", lead_gen_form_id: "form-1", page_id: options.formPage ?? "page-1", name: "Form", ...(options.omitFormState ? {} : { published: options.formPublished ?? true, usable: options.formUsable ?? true }) } as never,
      ],
      capabilities: {
        sales_website: { status: "available" },
        leads_website: { status: "available" },
        leads_instant_form: { status: "available" },
      },
    }),
    validateTarget: async () => options.validateTarget ?? true,
    now: () => current,
  });
  return { db, mediaRoot, operations, staged, stage, setNow: (value: Date) => { current = value; } };
}

function sales(media: { media_id: string; sha256: string }): CampaignRequest {
  return {
    type: "create_campaign_bundle" as const,
    client_id: "client-1",
    ad_account_id: "act_1",
    payload: {
      campaign_kind: "SALES_WEBSITE",
      campaign: { name: "Sales", budget: { kind: "daily" as const, value: { amount: "10.00", currency: "USD" } } },
      ad_set: { name: "Sales set", pixel_id: "pixel-1", targeting: { countries: ["US"], minimum_age: 21, maximum_age: 55 } },
      creative: { name: "Creative", page_id: "page-1", message: "Buy now", website_url: "https://example.com/product", call_to_action: "SHOP_NOW", media: [media] },
      ad: { name: "Sales ad" },
    },
  };
}

test("creates one immutable pending proposal and canonically reuses its permanent idempotency binding", async (t) => {
  const { db, operations, staged } = await fixture(t);
  const request = sales({ media_id: staged.media.media_id, sha256: staged.media.sha256 });
  assert.equal(canonicalPayload({ b: 2, a: { d: 4, c: 3 } }), canonicalPayload({ a: { c: 3, d: 4 }, b: 2 }));
  const created = await operations.propose({ actor: "openclaw:user-1", requestId: "request-propose-1", idempotencyKey: "idempotency-key-0001", request });
  const reused = await operations.propose({ actor: "openclaw:user-1", requestId: "request-propose-2", idempotencyKey: "idempotency-key-0001", request: structuredClone(request) });

  assert.equal(created.created, true);
  assert.equal(reused.created, false);
  assert.equal(reused.operation.operation_id, created.operation.operation_id);
  assert.equal(created.operation.status, "pending");
  assert.equal(created.operation.integration_generation, "generation-1");
  assert.equal(created.operation.expires_at, "2026-08-20T00:00:00.000Z");
  assert.equal(db.prepare("SELECT count(*) AS count FROM operations").get()!.count, 1);
  assert.equal(db.prepare("SELECT count(*) AS count FROM operation_idempotency").get()!.count, 1);
  assert.equal(db.prepare("SELECT count(*) AS count FROM operation_media").get()!.count, 1);
  assert.equal(db.prepare("SELECT status FROM staged_media WHERE id = ?").get(staged.media.media_id)!.status, "bound");
  assert.throws(() => db.prepare("UPDATE operations SET payload_json = '{}' WHERE id = ?").run(created.operation.operation_id), /immutable/);

  const conflict = structuredClone(request);
  conflict.payload.campaign.name = "Different";
  await assert.rejects(
    operations.propose({ actor: "openclaw:user-1", requestId: "request-propose-3", idempotencyKey: "idempotency-key-0001", request: conflict }),
    (error: unknown) => error instanceof OperationError && error.code === "idempotency_conflict",
  );
  assert.equal(db.prepare("SELECT count(*) AS count FROM audit_log WHERE logical_operation = 'propose_operation' AND outcome = 'failed'").get()!.count, 1);
  assert.equal(db.prepare("SELECT count(*) AS count FROM operation_audit_links WHERE operation_id = ?").get(created.operation.operation_id)!.count, 2);
});

test("canonicalizes nested Unicode object keys by UTF-16 code units without locale dependence", () => {
  const left = { "\uE000": 4, "😀": { "é": 3, "e\u0301": 2 }, A: 1 };
  const right = { A: 1, "😀": { "e\u0301": 2, "é": 3 }, "\uE000": 4 };
  const expected = '{"A":1,"😀":{"é":2,"é":3},"":4}';
  assert.equal(canonicalPayload(left), expected);
  assert.equal(canonicalPayload(right), expected);
  assert.equal(canonicalPayload({ text: "line\nquote\"", negativeZero: -0, decimal: 1.25 }), '{"decimal":1.25,"negativeZero":0,"text":"line\\nquote\\\""}');
  assert.equal(canonicalPayload({ 2: "two", 10: "ten" }), '{"10":"ten","2":"two"}');
  assert.throws(() => canonicalPayload({ invalid: Number.NaN }), /canonical JSON/i);
});

test("requires explicitly published and usable lead forms", async (t) => {
  for (const options of [{ formPublished: false }, { formUsable: false }, { omitFormState: true }]) {
    const value = await fixture(t, options);
    const request = sales({ media_id: value.staged.media.media_id, sha256: value.staged.media.sha256 });
    request.payload.campaign_kind = "LEADS_INSTANT_FORM";
    delete request.payload.ad_set.pixel_id;
    request.payload.ad_set.lead_gen_form_id = "form-1";
    delete request.payload.creative.website_url;
    request.payload.creative.call_to_action = "SIGN_UP";
    await assert.rejects(
      value.operations.propose({ actor: "openclaw:user-1", requestId: `request-form-${String(options.formPublished)}`, idempotencyKey: `idempotency-form-${crypto.randomUUID()}`, request }),
      (error: unknown) => error instanceof OperationError && error.code === "unsupported_campaign_combination",
    );
  }
});

test("compares offset-aware schedules as absolute instants", async (t) => {
  const valid = await fixture(t);
  const request = sales({ media_id: valid.staged.media.media_id, sha256: valid.staged.media.sha256 });
  request.payload.ad_set.start_time = "2026-11-01T01:30:00-04:00";
  request.payload.ad_set.end_time = "2026-11-01T01:15:00-05:00";
  assert.equal((await valid.operations.propose({ actor: "openclaw:user-1", requestId: "request-dst-offset", idempotencyKey: "idempotency-dst-offset", request })).created, true);

  for (const [start, end] of [
    ["2026-01-01T00:00:00+00:00", "2026-01-01T01:00:00+01:00"],
    ["not-an-instant", "2026-01-01T01:00:00Z"],
  ]) {
    const value = await fixture(t);
    const invalid = sales({ media_id: value.staged.media.media_id, sha256: value.staged.media.sha256 });
    invalid.payload.ad_set.start_time = start!;
    invalid.payload.ad_set.end_time = end!;
    await assert.rejects(value.operations.propose({ actor: "openclaw:user-1", requestId: "request-invalid-offset", idempotencyKey: `idempotency-${crypto.randomUUID()}`, request: invalid }), OperationError);
  }
});

test("rejects lifetime campaign budgets without an exact end time before persistence", async (t) => {
  const value = await fixture(t);
  const request = sales({ media_id: value.staged.media.media_id, sha256: value.staged.media.sha256 });
  request.payload.campaign.budget = { kind: "lifetime", value: { amount: "100.00", currency: "USD" } };

  await assert.rejects(
    value.operations.propose({ actor: "openclaw:user-1", requestId: "request-lifetime", idempotencyKey: "idempotency-lifetime", request }),
    (error: unknown) => error instanceof OperationError && error.code === "operation_semantics_invalid",
  );
  assert.equal(value.db.prepare("SELECT count(*) AS count FROM operations").get()!.count, 0);

  const app = await buildApp({ serviceToken: "service-token", handlers: createOperationHandlers(value.operations, "openclaw:user-1") });
  t.after(() => app.close());
  const response = await app.inject({
    method: "POST", url: "/v1/operations",
    headers: { authorization: "Bearer service-token", "content-type": "application/json", "x-request-id": "request-lifetime-contract", "idempotency-key": "idempotency-lifetime-contract" },
    payload: request,
  });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().code, "validation_error");
});

test("rejects more than one creative media binding at contract and runtime boundaries", async (t) => {
  const value = await fixture(t);
  const second = await value.stage();
  const request = sales({ media_id: value.staged.media.media_id, sha256: value.staged.media.sha256 });
  request.payload.creative.media.push({ media_id: second.media.media_id, sha256: second.media.sha256 });

  await assert.rejects(
    value.operations.propose({ actor: "openclaw:user-1", requestId: "request-multi-media", idempotencyKey: "idempotency-multi-media", request }),
    (error: unknown) => error instanceof OperationError && error.code === "operation_semantics_invalid",
  );
  assert.equal(value.db.prepare("SELECT count(*) AS count FROM operations").get()!.count, 0);

  const app = await buildApp({ serviceToken: "service-token", handlers: createOperationHandlers(value.operations, "openclaw:user-1") });
  t.after(() => app.close());
  const response = await app.inject({
    method: "POST", url: "/v1/operations",
    headers: { authorization: "Bearer service-token", "content-type": "application/json", "x-request-id": "request-multi-contract", "idempotency-key": "idempotency-multi-contract" },
    payload: request,
  });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().code, "validation_error");
});

test("returns an explicit allowlisted review projection instead of the stored payload", async (t) => {
  const value = await fixture(t);
  const request = sales({ media_id: value.staged.media.media_id, sha256: value.staged.media.sha256 });
  const result = await value.operations.propose({ actor: "openclaw:user-1", requestId: "request-review", idempotencyKey: "idempotency-review", request });
  const operation = result.operation as unknown as Record<string, unknown>;

  assert.equal("payload" in operation, false);
  assert.deepEqual(operation.review, request.payload);
  assert.equal(operation.payload_hash, createHash("sha256").update(canonicalPayload(request.payload)).digest("hex"));
  assert.equal(operation.next_action, "approve_or_reject");
});

test("database binds idempotency identity and enforces result and exact-expiry combinations", async (t) => {
  const { db, operations } = await fixture(t);
  const request = { type: "configure_monthly_budget", client_id: "client-1", ad_account_id: "act_1", payload: { monthly_budget: { amount: "100.00", currency: "USD" } } } as const;
  const created = await operations.propose({ actor: "openclaw:user-1", requestId: "request-db-operation", idempotencyKey: "idempotency-db-operation", request });
  const copy = (id: string, actor: string, status: string, result: string | null, expires: string) => db.prepare(`
    INSERT INTO operations
      (id, actor, client_id, ad_account_id, generation_id, operation_type, payload_json, payload_hash,
       derived_json, status, result_json, created_at, expires_at)
    SELECT ?, ?, client_id, ad_account_id, generation_id, operation_type, payload_json, payload_hash,
       derived_json, ?, ?, created_at, ? FROM operations WHERE id = ?
  `).run(id, actor, status, result, expires, created.operation.operation_id);
  assert.throws(() => copy("bad-result", "other", "succeeded", null, created.operation.expires_at), /constraint|result/i);
  assert.throws(() => copy("bad-operation-expiry", "other", "pending", null, "2026-08-19T23:59:59.999Z"), /constraint|expiry/i);
  copy("forged-operation", "bound-actor", "pending", null, created.operation.expires_at);
  assert.throws(() => db.prepare(`INSERT INTO operation_idempotency
    (actor, operation_type, client_id, ad_account_id, idempotency_key, payload_hash, operation_id, created_at)
    SELECT 'different-actor', operation_type, client_id, ad_account_id, 'different-idempotency-key', payload_hash, id, created_at
    FROM operations WHERE id = 'forged-operation'`).run(), /constraint|idempotency/i);
});

test("derives only the three fixed campaign combinations and rejects incompatible form, CTA, media, schedule, and currency inputs", async (t) => {
  const fixtureValue = await fixture(t);
  const { db, operations, staged, stage } = fixtureValue;
  const requests = [
    sales({ media_id: staged.media.media_id, sha256: staged.media.sha256 }),
    (() => {
      const request = sales({ media_id: "", sha256: "" });
      request.payload.campaign_kind = "LEADS_WEBSITE";
      request.payload.creative.call_to_action = "SIGN_UP";
      return request;
    })(),
    (() => {
      const request = sales({ media_id: "", sha256: "" });
      request.payload.campaign_kind = "LEADS_INSTANT_FORM";
      delete request.payload.ad_set.pixel_id;
      request.payload.ad_set.lead_gen_form_id = "form-1";
      delete request.payload.creative.website_url;
      request.payload.creative.call_to_action = "GET_QUOTE";
      return request;
    })(),
  ];
  for (let index = 1; index < requests.length; index += 1) {
    const media = await stage();
    requests[index]!.payload.creative.media = [{ media_id: media.media.media_id, sha256: media.media.sha256 }];
  }
  for (const [index, request] of requests.entries()) {
    const result = await operations.propose({ actor: "openclaw:user-1", requestId: `request-kind-${index}`, idempotencyKey: `idempotency-kind-${index}`.padEnd(20, "0"), request });
    assert.equal(result.operation.status, "pending");
  }
  assert.deepEqual(
    db.prepare("SELECT derived_json FROM operations ORDER BY created_at, rowid").all().map(({ derived_json }) => JSON.parse(String(derived_json))),
    [
      { billing_event: "IMPRESSIONS", conversion_event: "PURCHASE", destination: "WEBSITE", objective: "OUTCOME_SALES", optimization_goal: "OFFSITE_CONVERSIONS" },
      { billing_event: "IMPRESSIONS", conversion_event: "LEAD", destination: "WEBSITE", objective: "OUTCOME_LEADS", optimization_goal: "OFFSITE_CONVERSIONS" },
      { billing_event: "IMPRESSIONS", conversion_event: "LEAD", destination: "ON_AD", objective: "OUTCOME_LEADS", optimization_goal: "LEAD_GENERATION" },
    ],
  );

  const invalidFixture = await fixture(t, { formPage: "page-other" });
  const invalidMedia = invalidFixture.staged.media;
  const invalidForm = sales({ media_id: invalidMedia.media_id, sha256: invalidMedia.sha256 });
  invalidForm.payload.campaign_kind = "LEADS_INSTANT_FORM";
  delete invalidForm.payload.ad_set.pixel_id;
  invalidForm.payload.ad_set.lead_gen_form_id = "form-1";
  delete invalidForm.payload.creative.website_url;
  invalidForm.payload.creative.call_to_action = "SIGN_UP";
  await assert.rejects(
    invalidFixture.operations.propose({ actor: "openclaw:user-1", requestId: "request-invalid-form", idempotencyKey: "idempotency-invalid-form", request: invalidForm }),
    (error: unknown) => error instanceof OperationError && error.code === "unsupported_campaign_combination",
  );

  for (const mutate of [
    (request: CampaignRequest) => { request.payload.creative.call_to_action = "SIGN_UP"; },
    (request: CampaignRequest) => { request.payload.creative.media[0]!.sha256 = "0".repeat(64); },
    (request: CampaignRequest) => { request.payload.ad_set.start_time = "2026-08-20T00:00:00.000Z"; request.payload.ad_set.end_time = "2026-08-19T00:00:00.000Z"; },
    (request: CampaignRequest) => { request.payload.campaign.budget.value.currency = "EUR"; },
  ]) {
    const isolated = await fixture(t);
    const request = sales({ media_id: isolated.staged.media.media_id, sha256: isolated.staged.media.sha256 });
    mutate(request);
    await assert.rejects(isolated.operations.propose({ actor: "openclaw:user-1", requestId: "request-invalid-semantics", idempotencyKey: `idempotency-${crypto.randomUUID()}`, request }), OperationError);
    assert.equal(isolated.db.prepare("SELECT count(*) AS count FROM operations").get()!.count, 0);
  }
});

test("supports update, delivery, and local monthly-budget proposals but forbids Creative delivery and invalid targets", async (t) => {
  const { operations } = await fixture(t);
  const proposals = [
    { type: "update_object", client_id: "client-1", ad_account_id: "act_1", payload: { object_type: "campaign", object_id: "campaign-1", changes: { name: "Renamed" } } },
    { type: "change_delivery", client_id: "client-1", ad_account_id: "act_1", payload: { action: "PAUSE", object_type: "Campaign", object_id: "campaign-1" } },
    { type: "configure_monthly_budget", client_id: "client-1", ad_account_id: "act_1", payload: { monthly_budget: { amount: "1000.00", currency: "USD" } } },
  ] as const;
  for (const [index, request] of proposals.entries()) {
    const result = await operations.propose({ actor: "openclaw:user-1", requestId: `request-operation-${index}`, idempotencyKey: `idempotency-operation-${index}`, request });
    assert.equal((result.operation as unknown as { type: string }).type, request.type);
  }
  await assert.rejects(
    operations.propose({
      actor: "openclaw:user-1", requestId: "request-creative", idempotencyKey: "idempotency-creative",
      request: { type: "change_delivery", client_id: "client-1", ad_account_id: "act_1", payload: { action: "ACTIVATE", object_type: "Creative", object_id: "creative-1" } } as never,
    }),
    (error: unknown) => error instanceof OperationError && error.code === "operation_semantics_invalid",
  );
  await assert.rejects(
    operations.propose({
      actor: "openclaw:user-1", requestId: "request-update-schedule", idempotencyKey: "idempotency-update-schedule",
      request: { type: "update_object", client_id: "client-1", ad_account_id: "act_1", payload: { object_type: "ad_set", object_id: "adset-1", changes: { start_time: "2026-08-20T00:00:00.000Z", end_time: "2026-08-19T00:00:00.000Z" } } },
    }),
    (error: unknown) => error instanceof OperationError && error.code === "operation_semantics_invalid",
  );
  const invalid = await fixture(t, { validateTarget: false });
  await assert.rejects(
    invalid.operations.propose({ actor: "openclaw:user-1", requestId: "request-target", idempotencyKey: "idempotency-target", request: proposals[0] }),
    (error: unknown) => error instanceof OperationError && error.code === "asset_incompatible",
  );
});

test("preserves idempotency across concurrency and restart while rejecting expired media", async (t) => {
  const value = await fixture(t);
  const request = sales({ media_id: value.staged.media.media_id, sha256: value.staged.media.sha256 });
  const calls = await Promise.all([
    value.operations.propose({ actor: "openclaw:user-1", requestId: "request-concurrent-1", idempotencyKey: "idempotency-concurrent", request }),
    value.operations.propose({ actor: "openclaw:user-1", requestId: "request-concurrent-2", idempotencyKey: "idempotency-concurrent", request: structuredClone(request) }),
  ]);
  assert.equal(new Set(calls.map(({ operation }) => operation.operation_id)).size, 1);
  assert.equal(value.db.prepare("SELECT count(*) AS count FROM operations").get()!.count, 1);

  const restarted = createOperationsService({
    db: value.db,
    hashMediaFile: (await createMediaService({ db: value.db, dataRoot: join(value.mediaRoot, ".."), mediaRoot: value.mediaRoot, now: () => now })).hashFile,
    now: () => now,
    capabilities: async () => { throw new Error("idempotent reuse must not revalidate"); },
    validateTarget: async () => { throw new Error("idempotent reuse must not revalidate"); },
  });
  const replay = await restarted.propose({ actor: "openclaw:user-1", requestId: "request-restart", idempotencyKey: "idempotency-concurrent", request });
  assert.equal(replay.created, false);

  const expired = await fixture(t);
  expired.setNow(new Date(expired.staged.media.expires_at));
  await assert.rejects(
    expired.operations.propose({ actor: "openclaw:user-1", requestId: "request-expired-media", idempotencyKey: "idempotency-expired-media", request: sales({ media_id: expired.staged.media.media_id, sha256: expired.staged.media.sha256 }) }),
    (error: unknown) => error instanceof OperationError && error.code === "asset_incompatible",
  );

  const crossed = await fixture(t);
  const wrongScope = sales({ media_id: crossed.staged.media.media_id, sha256: crossed.staged.media.sha256 });
  wrongScope.ad_account_id = "act_2";
  await assert.rejects(
    crossed.operations.propose({ actor: "openclaw:user-1", requestId: "request-crossed-media", idempotencyKey: "idempotency-crossed-media", request: wrongScope }),
    (error: unknown) => error instanceof OperationError && error.code === "asset_incompatible",
  );
});

test("operation handlers enforce OpenAPI unions and return correlated create, reuse, conflict, semantic, and get responses", async (t) => {
  const { db, operations } = await fixture(t);
  const app = await buildApp({ serviceToken: "service-token", handlers: createOperationHandlers(operations, "openclaw:user-1") });
  t.after(() => app.close());
  const headers = {
    authorization: "Bearer service-token",
    "content-type": "application/json",
    "x-request-id": "request-operation-route",
    "idempotency-key": "idempotency-route-0001",
  };
  const request = { type: "configure_monthly_budget", client_id: "client-1", ad_account_id: "act_1", payload: { monthly_budget: { amount: "100.00", currency: "USD" } } };
  const created = await app.inject({ method: "POST", url: "/v1/operations", headers, payload: request });
  const reused = await app.inject({ method: "POST", url: "/v1/operations", headers, payload: structuredClone(request) });
  assert.equal(created.statusCode, 201);
  assert.equal(reused.statusCode, 200);
  assert.equal(created.headers["x-request-id"], "request-operation-route");
  assert.equal(created.json().operation.operation_id, reused.json().operation.operation_id);

  const fetched = await app.inject({
    method: "GET",
    url: `/v1/operations/${created.json().operation.operation_id}?client_id=client-1&ad_account_id=act_1`,
    headers: { authorization: "Bearer service-token", "x-request-id": "request-operation-get" },
  });
  assert.equal(fetched.statusCode, 200);
  assert.equal(fetched.json().request_id, "request-operation-get");
  assert.equal(fetched.json().operation.status, "pending");

  db.prepare("UPDATE integration_generations SET status = 'retired' WHERE id = 'generation-1'").run();
  const fetchedAfterRotation = await app.inject({
    method: "GET",
    url: `/v1/operations/${created.json().operation.operation_id}?client_id=client-1&ad_account_id=act_1`,
    headers: { authorization: "Bearer service-token", "x-request-id": "request-operation-get-retired" },
  });
  assert.equal(fetchedAfterRotation.statusCode, 200);
  assert.equal(fetchedAfterRotation.json().operation.operation_id, created.json().operation.operation_id);
  db.prepare("UPDATE integration_generations SET status = 'active' WHERE id = 'generation-1'").run();

  const conflict = await app.inject({ method: "POST", url: "/v1/operations", headers, payload: { ...request, payload: { monthly_budget: { amount: "200.00", currency: "USD" } } } });
  assert.equal(conflict.statusCode, 409);
  assert.equal(conflict.json().code, "idempotency_conflict");

  const semantic = await app.inject({
    method: "POST",
    url: "/v1/operations",
    headers: { ...headers, "idempotency-key": "idempotency-route-0002" },
    payload: { ...request, payload: { monthly_budget: { amount: "100.00", currency: "EUR" } } },
  });
  assert.equal(semantic.statusCode, 422);
  assert.equal(semantic.json().code, "operation_semantics_invalid");
  assert.deepEqual(semantic.json().supplied_scope, { client_id: "client-1", ad_account_id: "act_1" });

  for (const invalid of [
    { type: "delete_everything", client_id: "client-1", ad_account_id: "act_1", payload: {} },
    { type: "change_delivery", client_id: "client-1", ad_account_id: "act_1", payload: { action: "ACTIVATE", object_type: "Creative", object_id: "creative-1" } },
    { type: "change_delivery", client_id: "client-1", ad_account_id: "act_1", payload: { action: "DELETE", object_type: "Campaign", object_id: "campaign-1" } },
  ]) {
    const response = await app.inject({ method: "POST", url: "/v1/operations", headers: { ...headers, "idempotency-key": `idempotency-${crypto.randomUUID()}` }, payload: invalid });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().code, "validation_error");
  }
  assert.equal(db.prepare("SELECT count(*) AS count FROM operations").get()!.count, 1);
});
