import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { openDatabase } from "../src/db.js";
import { createMediaHandlers, createMediaService } from "../src/media.js";
import type { AsyncInsightsRequest, MetaPageRequest, MetaRequest } from "../src/meta-client.js";
import { createOperationHandlers, createOperationsService } from "../src/operations.js";
import { createPacingHandlers, createPacingService } from "../src/pacing.js";
import { createReportingHandlers, createReportingService } from "../src/reporting.js";
import {
  createGatewayClient,
  createOpenClawRegistration,
  handleStageMediaCommand,
  type Gateway,
} from "../packages/openclaw-plugin/src/core.js";

const at = new Date("2026-08-19T12:00:00.000Z");
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const pluginConfig = {
  baseUrl: "http://127.0.0.1:3000",
  keychainService: "svc",
  serviceTokenAccount: "token",
  ownerProofAccount: "proof",
  attachmentRoots: [] as string[],
};

function seed(db: ReturnType<typeof openDatabase>) {
  db.exec(`
    INSERT INTO clients (id, name, portfolio_id) VALUES
      ('client-us', 'US Client', 'portfolio-us'),
      ('client-jp', 'JP Client', 'portfolio-jp'),
      ('client-no-tz', 'No Timezone Client', 'portfolio-no-tz');
    INSERT INTO integrations (id, name, meta_app_id, state) VALUES ('integration-1', 'App', 'app-1', 'active');
    INSERT INTO integration_generations (id, integration_id, generation, status, validated_at)
      VALUES ('generation-1', 'integration-1', '2026-08', 'active', '${at.toISOString()}');
    INSERT INTO ad_accounts (id, client_id, name, currency, timezone) VALUES
      ('act_us', 'client-us', 'US Account', 'USD', 'America/New_York'),
      ('act_jp', 'client-jp', 'JP Account', 'JPY', 'Asia/Tokyo'),
      ('act_no_tz', 'client-no-tz', 'No Timezone Account', 'EUR', NULL);
    INSERT INTO encrypted_credentials
      (id, generation_id, subject_id, key_ref, envelope_version, ciphertext, iv, auth_tag, scopes, status, validated_at)
      VALUES ('credential-1', 'generation-1', 'subject-1', 'key', 1, 'cipher', 'iv', 'tag',
        '["ads_read","ads_management"]', 'active', '${at.toISOString()}');
    INSERT INTO scope_mappings
      (client_id, ad_account_id, generation_id, active, app_authorized, subject_authorized, partner_authorized, asset_authorized, granted_tasks)
      VALUES
      ('client-us', 'act_us', 'generation-1', 1, 1, 1, 1, 1, '["ADVERTISE"]'),
      ('client-jp', 'act_jp', 'generation-1', 1, 1, 1, 1, 1, '["ADVERTISE"]'),
      ('client-no-tz', 'act_no_tz', 'generation-1', 1, 1, 1, 1, 1, '["ADVERTISE"]');
    INSERT INTO budgets (client_id, ad_account_id, amount_minor, currency, updated_at) VALUES
      ('client-us', 'act_us', 10001, 'USD', '${at.toISOString()}'),
      ('client-jp', 'act_jp', 20001, 'JPY', '${at.toISOString()}'),
      ('client-no-tz', 'act_no_tz', 30001, 'EUR', '${at.toISOString()}');
  `);
}

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "openclaw-runtime-"));
  const db = openDatabase(":memory:");
  seed(db);
  const calls: Array<{ kind: string; path: string }> = [];
  const meta = {
    async request<T>(input: MetaRequest) {
      calls.push({ kind: "request", path: input.path });
      const account = input.scope.adAccountId === "act_us"
        ? { currency: "USD", timezone_name: "America/New_York" }
        : input.scope.adAccountId === "act_jp"
          ? { currency: "JPY", timezone_name: "Asia/Tokyo" }
          : { currency: "EUR" };
      const data = input.path.endsWith("/campaigns")
        ? { data: [{ id: `campaign-${input.scope.adAccountId}`, name: "Scoped Campaign", status: "PAUSED", objective: "OUTCOME_SALES" }], paging: {} }
        : account;
      return { data: data as T, rate: {} };
    },
    async paginate<T>(input: MetaPageRequest) {
      calls.push({ kind: "paginate", path: input.path });
      return [] as T[];
    },
    async runAsyncInsights<T>(input: AsyncInsightsRequest) {
      calls.push({ kind: "insights", path: input.path });
      const spend = input.scope.adAccountId === "act_us" ? "33.335" : "101.5";
      return [{ spend }] as T[];
    },
  };
  const reporting = createReportingService({ db, meta, cursorKey: Buffer.alloc(32, 9), now: () => at });
  const pacing = createPacingService({ db, meta, now: () => at });
  const media = await createMediaService({ db, dataRoot: root, mediaRoot: join(root, "media"), now: () => at });
  const operations = createOperationsService({
    db,
    hashMediaFile: async () => { throw new Error("media is not used by budget proposals"); },
    capabilities: async () => { throw new Error("capabilities are not used by budget proposals"); },
    validateTarget: async () => { throw new Error("targets are not used by budget proposals"); },
    now: () => at,
  });
  const app = await buildApp({
    serviceToken: "service-token",
    handlers: {
      ...createReportingHandlers(reporting, "openclaw"),
      ...createPacingHandlers(pacing, "openclaw"),
      ...createMediaHandlers(media, "openclaw"),
      ...createOperationHandlers(operations, "openclaw"),
    },
  });
  t.after(async () => {
    await app.close();
    db.close();
    await rm(root, { recursive: true, force: true });
  });
  return { root, db, app, calls };
}

function gatewayFor(app: FastifyInstance, urls: string[] = []): Gateway {
  return createGatewayClient({
    baseUrl: pluginConfig.baseUrl,
    getServiceToken: async () => "service-token",
    fetch: async (input, init) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      urls.push(`${url.pathname}${url.search}`);
      const response = await app.inject({
        method: request.method as "GET" | "POST",
        url: `${url.pathname}${url.search}`,
        headers: Object.fromEntries(request.headers.entries()),
        ...(request.method === "GET" ? {} : { payload: Buffer.from(await request.arrayBuffer()) }),
      });
      const headers = new Headers();
      for (const [name, value] of Object.entries(response.headers)) {
        if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : String(value));
      }
      return new Response(response.body, { status: response.statusCode, headers });
    },
  });
}

function registration(gateway: Gateway) {
  return createOpenClawRegistration({
    config: pluginConfig,
    gateway,
  });
}

function tool(value: ReturnType<typeof createOpenClawRegistration>, name: string) {
  return value.tools.find((candidate) => candidate.name === name)!;
}

test("same-message owner command sends canonical trusted metadata through actual Fastify media validation", async (t) => {
  const { root, db, app } = await fixture(t);
  const path = join(root, "creative.png");
  await writeFile(path, png);
  const result = await handleStageMediaCommand({
    config: { ...pluginConfig, attachmentRoots: [root] }, gateway: gatewayFor(app), ownerAllowFrom: ["telegram:sender-1"], now: () => at.getTime(),
    context: { channelId: "telegram", accountId: "main", conversationId: "chat-1", senderId: "sender-1", messageId: "message-1" },
    event: {
      content: "/stage-ad-media client-us act_us", timestamp: at.getTime(), channel: "telegram", senderId: "sender-1", messageId: "message-1",
      commandAuthorized: true, senderIsOwner: true, media: [{ path, contentType: "image/png", messageId: "message-1" }],
    },
  });
  const row = db.prepare("SELECT attachment_id, original_filename, correlation_id, status FROM staged_media").get()!;
  assert.deepEqual({ original_filename: row.original_filename, correlation_id: row.correlation_id, status: row.status }, {
    original_filename: "creative.png", correlation_id: String(row.correlation_id), status: "staged",
  });
  assert.match(String(row.attachment_id), /^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/);
  assert.doesNotMatch(String(row.attachment_id), /message-1|creative|sender|chat|discord/i);
  assert.match(result.reply!.text, /Staged [0-9a-f-]{36} \(image\/png, 68 bytes, SHA-256 [a-f0-9]{64}\) for client-us\/act_us/);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(`${root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}|https?://|schema`, "i"));
  assert.equal(result.handled, true);
});

test("decimal-safe independent budgets retain currencies without ranking or aggregation", async (t) => {
  const { app } = await fixture(t);
  const result = await tool(registration(gatewayFor(app)), "budget_summary").execute("global-money", {
    global: true, as_of: at.toISOString(), limit: 2,
  }) as { details: { data: Array<{ pacing: Record<string, any> }> } };
  assert.deepEqual(result.details.data.map(({ pacing }) => [pacing.scope.client_id, pacing.monthly_budget.value, pacing.mtd_spend.value]), [
    ["client-jp", { amount: "20001", currency: "JPY" }, { amount: "102", currency: "JPY" }],
    ["client-no-tz", { amount: "300.01", currency: "EUR" }, undefined],
    ["client-us", { amount: "100.01", currency: "USD" }, { amount: "33.34", currency: "USD" }],
  ]);
  assert.deepEqual(Object.keys(result.details).sort(), ["composition", "data"]);
  assert.equal(/rank|aggregate|total|shared_budget/i.test(JSON.stringify(result.details)), false);
});

test("model-tool success and failure preserve safe scope remediation and correlation", async (t) => {
  const { app } = await fixture(t);
  const capabilities = tool(registration(gatewayFor(app)), "get_capabilities");
  const success = await capabilities.execute("capabilities-ok", { client_id: "client-us", ad_account_id: "act_us", limit: 10 }) as { details: Record<string, any> };
  assert.deepEqual(success.details.scope.client_id, "client-us");
  assert.ok(success.details.gaps.length > 0);
  assert.ok(success.details.gaps.every((gap: Record<string, unknown>) => typeof gap.remediation === "string" && gap.remediation.length > 0));
  assert.match(success.details.request_id, /^[0-9a-f-]{36}$/i);

  const failure = await capabilities.execute("capabilities-fail", { client_id: "unknown-client", ad_account_id: "unknown-account", limit: 10 }) as { details: Record<string, any> };
  assert.deepEqual(failure.details.supplied_scope, { client_id: "unknown-client", ad_account_id: "unknown-account" });
  assert.equal(failure.details.error.code, "gateway_request_failed");
  assert.match(failure.details.error.remediation, /authorized pair/i);
  assert.match(failure.details.request_id, /^[0-9a-f-]{36}$/i);
  assert.doesNotMatch(JSON.stringify(failure), /Scope is not authorized|Upstream error|authorization/i);
});

test("authorized plugin read returns only scoped reporting and creates no decision or mutation", async (t) => {
  const { app, db, calls } = await fixture(t);
  const result = await tool(registration(gatewayFor(app)), "list_campaigns").execute("campaign-read", {
    client_id: "client-us", ad_account_id: "act_us", limit: 10,
  }) as { details: Record<string, any> };
  assert.equal(result.details.scope.client_id, "client-us");
  assert.equal(result.details.scope.ad_account_id, "act_us");
  assert.deepEqual(result.details.data.map((campaign: Record<string, unknown>) => campaign.campaign_id), ["campaign-act_us"]);
  assert.deepEqual(calls.filter(({ kind }) => kind === "request").map(({ path }) => path), ["/act_us/campaigns"]);
  assert.equal(db.prepare("SELECT count(*) AS count FROM operations").get()!.count, 0);
  assert.equal(db.prepare("SELECT count(*) AS count FROM approval_decisions").get()!.count, 0);
  assert.equal(db.prepare("SELECT count(*) AS count FROM operation_executions").get()!.count, 0);
});

test("proposal tool creates one explicit pending operation without owner authority or execution", async (t) => {
  const { app, db, calls } = await fixture(t);
  const result = await tool(registration(gatewayFor(app)), "propose_operation").execute("proposal-1", {
    client_id: "client-us",
    ad_account_id: "act_us",
    idempotency_key: "plugin-proposal-key-0001",
    type: "configure_monthly_budget",
    payload: { monthly_budget: { amount: "432.10", currency: "USD" } },
  }) as { details: Record<string, any> };
  assert.equal(result.details.operation.status, "pending");
  assert.equal(result.details.operation.next_action, "approve_or_reject");
  assert.equal(result.details.operation.scope.client_id, "client-us");
  assert.equal(result.details.operation.scope.ad_account_id, "act_us");
  assert.equal(result.details.operation.decision, null);
  assert.equal(db.prepare("SELECT count(*) AS count FROM operations WHERE status = 'pending'").get()!.count, 1);
  assert.equal(db.prepare("SELECT count(*) AS count FROM approval_decisions").get()!.count, 0);
  assert.equal(db.prepare("SELECT count(*) AS count FROM operation_executions").get()!.count, 0);
  assert.equal(db.prepare("SELECT amount_minor FROM budgets WHERE client_id = 'client-us' AND ad_account_id = 'act_us'").get()!.amount_minor, 10001);
  assert.deepEqual(calls, []);
});

test("global plugin composition pages every scope into independent rows and retains unavailable values", async (t) => {
  const { app } = await fixture(t);
  const urls: string[] = [];
  const result = await tool(registration(gatewayFor(app, urls)), "budget_summary").execute("global-pages", {
    global: true, as_of: at.toISOString(), limit: 1,
  }) as { details: { composition: string; data: Array<{ request_id: string; pacing: Record<string, any> }> } };
  assert.equal(result.details.composition, "independent_scoped_pacing");
  assert.equal(urls.filter((url) => url.startsWith("/v1/scopes?")).length, 3);
  assert.deepEqual(result.details.data.map(({ pacing }) => [pacing.scope.client_id, pacing.scope.ad_account_id]), [
    ["client-jp", "act_jp"], ["client-no-tz", "act_no_tz"], ["client-us", "act_us"],
  ]);
  const unavailable = result.details.data.find(({ pacing }) => pacing.scope.ad_account_id === "act_no_tz")!;
  assert.equal(unavailable.pacing.availability, "unavailable");
  assert.equal(unavailable.pacing.remaining.reason, "timezone_unavailable");
  assert.ok(result.details.data.every(({ request_id }) => /^[0-9a-f-]{36}$/i.test(request_id)));
  assert.equal(/rank|aggregate|total/i.test(JSON.stringify(result.details)), false);
});
