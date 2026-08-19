import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";
import { openDatabase, type AuditEvent } from "../src/db.js";
import { MetaError, createMetaClient, type AsyncInsightsRequest, type MetaPageRequest, type MetaRequest } from "../src/meta-client.js";
import {
  createReportingHandlers,
  createReportingService,
  type ReportingMetaClient,
} from "../src/reporting.js";

const now = new Date("2026-08-19T12:00:00.000Z");

function seed(db: ReturnType<typeof openDatabase>) {
  db.prepare("INSERT INTO clients (id, name, portfolio_id) VALUES (?, ?, ?)").run("client-1", "Client One", "portfolio-1");
  db.prepare("INSERT INTO integrations (id, name, meta_app_id, state) VALUES (?, ?, ?, ?)").run(
    "integration-1",
    "Agency App",
    "app-1",
    "active",
  );
  db.prepare(
    "INSERT INTO integration_generations (id, integration_id, generation, status, validated_at) VALUES (?, ?, ?, ?, ?)",
  ).run("generation-1", "integration-1", "2026-08", "active", now.toISOString());
  for (const [id, name, currency, timezone] of [
    ["act_1", "Account One", "USD", "America/New_York"],
    ["act_2", "Account Two", "EUR", null],
  ] as const) {
    db.prepare("INSERT INTO ad_accounts (id, client_id, name, currency, timezone) VALUES (?, ?, ?, ?, ?)").run(
      id,
      "client-1",
      name,
      currency,
      timezone,
    );
    db.prepare(
      `INSERT INTO scope_mappings
        (client_id, ad_account_id, generation_id, active, app_authorized, subject_authorized, partner_authorized, asset_authorized, granted_tasks)
       VALUES (?, ?, ?, 1, 1, 1, 1, 1, ?)`,
    ).run("client-1", id, "generation-1", JSON.stringify(["ADVERTISE"]));
  }
  db.prepare(
    `INSERT INTO encrypted_credentials
      (id, generation_id, subject_id, key_ref, envelope_version, ciphertext, iv, auth_tag, scopes, status, validated_at)
     VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, 'active', ?)`,
  ).run(
    "credential-1",
    "generation-1",
    "subject-1",
    "database-key",
    "ciphertext",
    "iv",
    "tag",
    JSON.stringify(["ads_read", "ads_management", "pages_read_engagement", "leads_retrieval", "instagram_basic"]),
    now.toISOString(),
  );
}

function fakeMeta() {
  const calls: Array<{ kind: "request" | "paginate" | "insights"; path: string; account: string; correlationId: string }> = [];
  let insightRows: unknown[] = [];
  const meta: ReportingMetaClient = {
    async request<T>(input: MetaRequest) {
      calls.push({ kind: "request", path: input.path, account: input.scope.adAccountId, correlationId: input.correlationId });
      if (input.path.endsWith("/campaigns")) {
        return {
          rate: {},
          data: {
            data: [
              {
                id: `${input.scope.adAccountId}-campaign`,
                name: "Campaign",
                status: "ACTIVE",
                objective: "OUTCOME_SALES",
                daily_budget: "1235",
              },
            ],
            paging: { cursors: { after: "meta-next" } },
          } as T,
        };
      }
      return {
        rate: {},
        data: {
          currency: input.scope.adAccountId === "act_1" ? "USD" : "EUR",
          timezone_name: input.scope.adAccountId === "act_1" ? "America/New_York" : null,
          promote_pages: { data: [{ id: "page-2", name: "Second" }, { id: "page-1", name: "First" }] },
          adspixels: { data: [{ id: "pixel-1", name: "Pixel" }] },
          datasets: { data: [{ id: "dataset-1", name: "Dataset" }] },
          leadgen_forms: {
            data: [
              { id: "form-draft", page_id: "page-1", name: "Draft", status: "DRAFT" },
              { id: "form-1", page_id: "page-1", name: "Published", status: "ACTIVE" },
            ],
          },
          instagram_accounts: { data: [{ id: "ig-1", page_id: "page-1", name: "Instagram" }] },
        } as T,
      };
    },
    async paginate<T>(input: MetaPageRequest) {
      calls.push({ kind: "paginate", path: input.path, account: input.scope.adAccountId, correlationId: input.correlationId });
      const rows = input.path.endsWith("/promote_pages")
        ? [{ id: "page-2", name: "Second" }, { id: "page-1", name: "First" }]
        : input.path.endsWith("/adspixels")
          ? [{ id: "pixel-1", name: "Pixel" }]
          : input.path.endsWith("/datasets")
            ? [{ id: "dataset-1", name: "Dataset" }]
            : input.path.endsWith("/leadgen_forms")
              ? [{ id: "form-draft", page_id: "page-1", name: "Draft", status: "DRAFT" }, { id: "form-1", page_id: "page-1", name: "Published", status: "ACTIVE" }]
              : [{ id: "ig-1", page_id: "page-1", name: "Instagram" }];
      return rows as T[];
    },
    async runAsyncInsights<T>(input: AsyncInsightsRequest) {
      calls.push({ kind: "insights", path: input.path, account: input.scope.adAccountId, correlationId: input.correlationId });
      return insightRows as T[];
    },
  };
  return { meta, calls, setInsightRows: (rows: unknown[]) => (insightRows = rows) };
}

function fixture() {
  const db = openDatabase(":memory:");
  seed(db);
  const fake = fakeMeta();
  const service = createReportingService({
    db,
    meta: fake.meta,
    cursorKey: Buffer.alloc(32, 7),
    now: () => now,
  });
  return { db, service, ...fake };
}

test("scope discovery is deterministic and rejects cursors rebound to another caller", () => {
  const { db, service } = fixture();
  try {
    const first = service.listScopes({ actor: "caller-1", requestId: "request-1234", limit: 1 });
    assert.deepEqual(first.data.map(({ ad_account_id }) => ad_account_id), ["act_1"]);
    assert.ok(first.page.next_cursor);
    const second = service.listScopes({
      actor: "caller-1",
      requestId: "request-5678",
      limit: 1,
      cursor: first.page.next_cursor!,
    });
    assert.deepEqual(second.data.map(({ ad_account_id }) => ad_account_id), ["act_2"]);
    assert.throws(
      () => service.listScopes({ actor: "caller-2", requestId: "request-9012", limit: 1, cursor: first.page.next_cursor! }),
      /cursor binding/i,
    );
    assert.throws(
      () => service.listScopes({ actor: "caller-1", requestId: "request-3456", limit: 2, cursor: first.page.next_cursor! }),
      /cursor binding/i,
    );
  } finally {
    db.close();
  }
});

test("integration status and capabilities repeat safe scoped context with deterministic usable assets and gaps", async () => {
  const { db, service } = fixture();
  try {
    const status = service.getIntegrationStatus({
      actor: "caller-1",
      requestId: "request-1234",
      clientId: "client-1",
      adAccountId: "act_1",
    });
    assert.equal(status.integration.state, "active");
    assert.equal(status.scope?.ad_account_id, "act_1");
    assert.deepEqual(status.integration.missing_permissions, []);

    const capabilities = await service.getCapabilities({
      actor: "caller-1",
      requestId: "request-5678",
      clientId: "client-1",
      adAccountId: "act_2",
      limit: 100,
    });
    assert.deepEqual(capabilities.supported_campaign_kinds, ["SALES_WEBSITE", "LEADS_WEBSITE", "LEADS_INSTANT_FORM"]);
    assert.deepEqual(capabilities.assets.map((asset) => asset.asset_type), [
      "instagram_account",
      "lead_form",
      "page",
      "page",
      "pixel",
      "web_dataset",
    ]);
    assert.equal(capabilities.assets.some((asset) => "lead_gen_form_id" in asset && asset.lead_gen_form_id === "form-draft"), false);
    assert.equal(capabilities.account.timezone, null);
    assert.equal(Object.hasOwn(capabilities, "data"), false);
    assert.equal(capabilities.capabilities.media_upload.status, "available");
    assert.equal(capabilities.capabilities.proposal_creation.status, "available");
    assert.equal(capabilities.gaps.some(({ code }) => code === "operation_slice_unavailable"), false);
    assert.deepEqual(capabilities.gaps.filter(({ code }) => code === "account_timezone_unavailable").map(({ code }) => code), [
      "account_timezone_unavailable",
    ]);
    for (const check of Object.values(capabilities.capabilities)) {
      for (const code of check.diagnostic_codes) {
        assert.equal(capabilities.gaps.filter((gap) => gap.code === code).length, 1);
      }
    }

    db.prepare("DELETE FROM encrypted_credentials").run();
    const degraded = service.getIntegrationStatus({ actor: "caller-1", requestId: "request-9012" });
    assert.equal(degraded.integration.state, "reauthorization_required");
    assert.deepEqual(degraded.integration.missing_permissions, ["ads_read"]);
  } finally {
    db.close();
  }
});

test("capabilities traverse every Meta asset edge through bounded pagination and surface loop failures", async () => {
  const db = openDatabase(":memory:");
  seed(db);
  const audits: AuditEvent[] = [];
  const requests: string[] = [];
  const meta = createMetaClient({
    fetch: async (input) => {
      const url = new URL(String(input));
      requests.push(`${url.pathname}?after=${url.searchParams.get("after") ?? ""}`);
      if (url.pathname === "/v26.0/act_1") return new Response(JSON.stringify({ currency: "USD", timezone_name: "America/New_York" }), { status: 200 });
      const after = url.searchParams.get("after");
      if (url.pathname.endsWith("/promote_pages")) {
        return new Response(JSON.stringify(after === null
          ? { data: [{ id: "page-1", name: "First" }], paging: { cursors: { after: "pages-2" } } }
          : { data: [{ id: "page-2", name: "Second" }], paging: {} }), { status: 200 });
      }
      if (url.pathname.endsWith("/adspixels")) return new Response(JSON.stringify({ data: [{ id: "pixel-1", name: "Pixel" }], paging: {} }), { status: 200 });
      if (url.pathname.endsWith("/datasets")) return new Response(JSON.stringify({ data: [{ id: "dataset-1", name: "Dataset" }], paging: {} }), { status: 200 });
      if (url.pathname.endsWith("/leadgen_forms")) return new Response(JSON.stringify({ data: [{ id: "form-1", page_id: "page-1", name: "Form", status: "ACTIVE" }], paging: {} }), { status: 200 });
      return new Response(JSON.stringify({ data: [{ id: "ig-1", page_id: "page-1", name: "Instagram" }], paging: {} }), { status: 200 });
    },
    getCredentials: async () => ({ accessToken: "token", appSecret: "secret" }),
    audit: async (event) => audits.push(event),
    maxPages: 3,
  });
  try {
    const service = createReportingService({ db, meta, cursorKey: Buffer.alloc(32, 7), now: () => now });
    const result = await service.getCapabilities({
      actor: "caller-1", requestId: "request-pagination", clientId: "client-1", adAccountId: "act_1", limit: 100,
    });
    assert.deepEqual(result.assets.filter(({ asset_type }) => asset_type === "page").map((asset) => "page_id" in asset ? asset.page_id : ""), ["page-1", "page-2"]);
    assert.equal(requests.filter((value) => value.includes("/promote_pages")).length, 2);
    assert.equal(audits.filter(({ operation }) => operation === "get_capabilities_pages").length, 4);

    const loopingMeta = createMetaClient({
      fetch: async (input) => {
        const url = new URL(String(input));
        if (url.pathname === "/v26.0/act_1") return new Response(JSON.stringify({ currency: "USD", timezone_name: "America/New_York" }), { status: 200 });
        if (url.pathname.endsWith("/promote_pages")) return new Response(JSON.stringify({ data: [{ id: "page-1", name: "First" }], paging: { cursors: { after: "same" } } }), { status: 200 });
        return new Response(JSON.stringify({ data: [], paging: {} }), { status: 200 });
      },
      getCredentials: async () => ({ accessToken: "token", appSecret: "secret" }),
      audit: () => undefined,
      maxPages: 3,
    });
    const loopingService = createReportingService({ db, meta: loopingMeta, cursorKey: Buffer.alloc(32, 7), now: () => now });
    await assert.rejects(
      loopingService.getCapabilities({ actor: "caller-1", requestId: "request-loop", clientId: "client-1", adAccountId: "act_1", limit: 100 }),
      /repeated cursor/i,
    );
  } finally {
    db.close();
  }
});

test("capabilities require endpoint permissions, asset tasks, and all campaign-kind asset dependencies", async () => {
  const { db, service } = fixture();
  try {
    db.prepare("UPDATE encrypted_credentials SET scopes = ?").run(JSON.stringify(["ads_read", "ads_management", "pages_read_engagement", "leads_retrieval"]));
    db.prepare("UPDATE scope_mappings SET granted_tasks = '[]'").run();
    const result = await service.getCapabilities({
      actor: "caller-1", requestId: "request-authority", clientId: "client-1", adAccountId: "act_1", limit: 100,
    });
    for (const kind of ["sales_website", "leads_website", "leads_instant_form"] as const) {
      assert.equal(result.capabilities[kind].status, "unavailable");
    }
    assert.equal(result.gaps.some(({ code }) => code === "instagram_basic_permission_missing"), true);
    assert.equal(result.gaps.some(({ code }) => code === "advertise_task_missing"), true);

    const edgeFailureMeta: ReportingMetaClient = {
      ...fakeMeta().meta,
      async paginate<T>(input: MetaPageRequest) {
        if (input.path.endsWith("/adspixels")) throw new MetaError("denied", "meta_200", 403);
        return [] as T[];
      },
    };
    db.prepare("UPDATE encrypted_credentials SET scopes = ?").run(JSON.stringify(["ads_read", "ads_management", "pages_read_engagement", "leads_retrieval", "instagram_basic"]));
    db.prepare("UPDATE scope_mappings SET granted_tasks = ?").run(JSON.stringify(["ADVERTISE"]));
    const edgeService = createReportingService({ db, meta: edgeFailureMeta, cursorKey: Buffer.alloc(32, 7), now: () => now });
    const edgeResult = await edgeService.getCapabilities({
      actor: "caller-1", requestId: "request-edge", clientId: "client-1", adAccountId: "act_1", limit: 100,
    });
    assert.equal(edgeResult.gaps.some(({ code }) => code === "pixel_access_missing"), true);
    assert.equal(edgeResult.capabilities.sales_website.status, "unavailable");
  } finally {
    db.close();
  }
});

test("campaign reads resolve the exact account before Meta and bind cursors to scope and filters", async () => {
  const { db, service, calls } = fixture();
  try {
    const page = await service.listCampaigns({
      actor: "caller-1",
      requestId: "request-1234",
      clientId: "client-1",
      adAccountId: "act_1",
      status: "ACTIVE",
      limit: 1,
    });
    assert.deepEqual(page.data.map(({ campaign_id }) => campaign_id), ["act_1-campaign"]);
    assert.deepEqual(page.data[0]!.daily_budget, { amount: "12.35", currency: "USD" });
    assert.equal(page.scope.ad_account_id, "act_1");
    assert.ok(page.page.next_cursor);
    await assert.rejects(
      service.listCampaigns({
        actor: "caller-1",
        requestId: "request-5678",
        clientId: "client-1",
        adAccountId: "act_2",
        status: "ACTIVE",
        limit: 1,
        cursor: page.page.next_cursor!,
      }),
      /cursor binding/i,
    );
    const before = calls.length;
    await assert.rejects(
      service.listCampaigns({
        actor: "caller-1",
        requestId: "request-9012",
        clientId: "other-client",
        adAccountId: "act_1",
        limit: 10,
      }),
      /scope is not authorized/i,
    );
    assert.equal(calls.length, before);
  } finally {
    db.close();
  }
});

test("Insights return empty valid pages and typed partial metrics without inventing zero", async () => {
  const { db, service, setInsightRows, calls } = fixture();
  const query = {
    actor: "caller-1",
    requestId: "request-1234",
    clientId: "client-1",
    adAccountId: "act_1",
    dateRange: { since: "2026-08-01", until: "2026-08-19" },
    level: "campaign" as const,
    limit: 50,
  };
  try {
    const empty = await service.queryInsights(query);
    assert.deepEqual(empty.data, []);

    setInsightRows([
      {
        campaign_id: "campaign-1",
        campaign_name: "Campaign One",
        date_start: "2026-08-01",
        date_stop: "2026-08-19",
        spend: "12.345",
        impressions: "100",
        reach: "80",
        clicks: "5",
        ctr: "1.2345675",
        cpc: "2.469",
        cpm: "123.45",
      },
    ]);
    const result = await service.queryInsights(query);
    const metrics = result.data[0]!.metrics;
    assert.deepEqual(metrics.spend, { available: true, value: { amount: "12.34", currency: "USD" } });
    assert.deepEqual(metrics.impressions, { available: true, value: 100 });
    assert.deepEqual(metrics.ctr, { available: true, value: "1.234568" });
    assert.deepEqual(metrics.roas, {
      available: false,
      reason: "value_data_missing",
      detail: "Meta did not report ROAS value data",
    });
    assert.deepEqual(metrics.results, {
      available: false,
      reason: "value_not_reported",
      detail: "Meta did not report results",
    });

    const before = calls.length;
    await assert.rejects(service.queryInsights({ ...query, dateRange: { since: "2026-08-20", until: "2026-08-19" } }), /unsupported query/i);
    assert.equal(calls.length, before);
  } finally {
    db.close();
  }
});

test("reporting handlers produce OpenAPI-valid discovery and reporting responses", async (t) => {
  const { db, service } = fixture();
  t.after(() => db.close());
  const app = await buildApp({
    serviceToken: "service-token",
    handlers: createReportingHandlers(service, "caller-1"),
  });
  t.after(() => app.close());
  const headers = { authorization: "Bearer service-token", "x-request-id": "request-1234" };

  const scopes = await app.inject({ method: "GET", url: "/v1/scopes?limit=1", headers });
  assert.equal(scopes.statusCode, 200);
  assert.equal(scopes.json().data[0].client_id, "client-1");

  const campaigns = await app.inject({
    method: "GET",
    url: "/v1/campaigns?client_id=client-1&ad_account_id=act_1&limit=10",
    headers,
  });
  assert.equal(campaigns.statusCode, 200);
  assert.equal(campaigns.json().scope.ad_account_id, "act_1");

  const capabilities = await app.inject({
    method: "GET",
    url: "/v1/capabilities?client_id=client-1&ad_account_id=act_1&limit=10",
    headers,
  });
  assert.equal(capabilities.statusCode, 200);
  assert.equal(capabilities.json().assets[0].asset_type, "instagram_account");

  const insights = await app.inject({
    method: "POST",
    url: "/v1/insights/query?limit=10",
    headers: { ...headers, "content-type": "application/json" },
    payload: {
      client_id: "client-1",
      ad_account_id: "act_1",
      date_range: { since: "2026-08-01", until: "2026-08-19" },
      level: "campaign",
    },
  });
  assert.equal(insights.statusCode, 200);
  assert.deepEqual(insights.json().data, []);
});

test("capability-specific errors preserve raw supplied scope and never expose resolved scope", async (t) => {
  const { db, service } = fixture();
  t.after(() => db.close());
  const app = await buildApp({ serviceToken: "service-token", handlers: createReportingHandlers(service, "caller-1") });
  t.after(() => app.close());
  const cases = [
    { url: "/v1/capabilities?client_id=client%2Braw&ad_account_id=act%2Fraw&limit=0", status: 400, headers: { authorization: "Bearer service-token" }, supplied: { client_id: "client+raw", ad_account_id: "act/raw" } },
    { url: "/v1/capabilities?client_id=client-1&ad_account_id=act_1&cursor=invalid", status: 400, headers: { authorization: "Bearer service-token" }, supplied: { client_id: "client-1", ad_account_id: "act_1" } },
    { url: "/v1/capabilities?client_id=other-client&ad_account_id=act_1", status: 409, headers: { authorization: "Bearer service-token" }, supplied: { client_id: "other-client", ad_account_id: "act_1" } },
    { url: "/v1/capabilities?client_id=client-1&ad_account_id=act_1", status: 401, headers: {}, supplied: { client_id: "client-1", ad_account_id: "act_1" } },
  ];
  for (const entry of cases) {
    const response = await app.inject({ method: "GET", url: entry.url, headers: { ...entry.headers, "x-request-id": `request-${entry.status}` } });
    assert.equal(response.statusCode, entry.status, entry.url);
    assert.deepEqual(response.json().supplied_scope, entry.supplied, entry.url);
    assert.equal(Object.hasOwn(response.json(), "resolved_scope"), false, entry.url);
  }
  const forbidden = await app.inject({
    method: "GET",
    url: "/v1/capabilities?client_id=client-1&ad_account_id=act_1",
    headers: { authorization: "Bearer service-token", "x-request-id": "request-403" },
    remoteAddress: "192.0.2.1",
  });
  assert.equal(forbidden.statusCode, 403);
  assert.deepEqual(forbidden.json().supplied_scope, { client_id: "client-1", ad_account_id: "act_1" });
  assert.equal(Object.hasOwn(forbidden.json(), "resolved_scope"), false);
});

test("Meta 429 remains a contract-valid 429 with serialized Retry-After", async (t) => {
  const db = openDatabase(":memory:");
  seed(db);
  t.after(() => db.close());
  const meta: ReportingMetaClient = {
    async request() { throw new MetaError("rate limited", "meta_4", 429, 2); },
    async paginate() { return []; },
    async runAsyncInsights() { return []; },
  };
  const service = createReportingService({ db, meta, cursorKey: Buffer.alloc(32, 7), now: () => now });
  const validations: Array<{ statusCode: number; errors: string[] }> = [];
  const app = await buildApp({
    serviceToken: "service-token",
    handlers: createReportingHandlers(service, "caller-1"),
    testHooks: { onResponseValidation: ({ statusCode, errors }) => validations.push({ statusCode, errors }) },
  });
  t.after(() => app.close());
  const response = await app.inject({
    method: "GET",
    url: "/v1/campaigns?client_id=client-1&ad_account_id=act_1",
    headers: { authorization: "Bearer service-token", "x-request-id": "request-rate" },
  });
  assert.equal(response.statusCode, 429);
  assert.equal(response.headers["retry-after"], "2");
  assert.deepEqual(validations.at(-1), { statusCode: 429, errors: [] });
});

test("reporting handlers generate one request ID for service, Meta, header, body, and errors", async (t) => {
  const { db, service, calls } = fixture();
  t.after(() => db.close());
  const app = await buildApp({ serviceToken: "service-token", handlers: createReportingHandlers(service, "caller-1") });
  t.after(() => app.close());
  const success = await app.inject({
    method: "GET",
    url: "/v1/campaigns?client_id=client-1&ad_account_id=act_1",
    headers: { authorization: "Bearer service-token" },
  });
  assert.equal(success.statusCode, 200);
  assert.equal(success.headers["x-request-id"], success.json().request_id);
  assert.equal(calls.at(-1)!.correlationId, success.json().request_id);

  const failure = await app.inject({
    method: "GET",
    url: "/v1/campaigns?client_id=other-client&ad_account_id=act_1",
    headers: { authorization: "Bearer service-token" },
  });
  assert.equal(failure.statusCode, 409);
  assert.equal(failure.headers["x-request-id"], failure.json().request_id);
});
