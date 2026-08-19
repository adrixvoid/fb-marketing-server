import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";
import { openDatabase } from "../src/db.js";
import type { AsyncInsightsRequest, MetaRequest } from "../src/meta-client.js";
import type { components } from "../src/generated/openapi.js";
import {
  calculatePacing,
  createPacingHandlers,
  createPacingService,
  type PacingMetaClient,
} from "../src/pacing.js";

const scope = {
  client_id: "client-1",
  client_name: "Client One",
  ad_account_id: "act_1",
  ad_account_name: "Account One",
  currency: "USD",
  timezone: "America/New_York",
};
const { timezone: _timezone, ...scopeWithoutTimezone } = scope;

test("pacing uses exact DST-aware month duration and half-even decimal arithmetic", () => {
  const pacing = calculatePacing({
    scope,
    currency: "USD",
    timezone: "America/New_York",
    monthlyBudgetMinor: 10_000,
    mtdSpend: "60.00",
    asOf: "2026-03-16T04:00:00.000Z",
  });
  assert.equal(pacing.availability, "available");
  assert.deepEqual(pacing, {
    availability: "available",
    scope,
    timezone: "America/New_York",
    currency: "USD",
    reporting_month: "2026-03",
    as_of: "2026-03-16T04:00:00.000Z",
    pacing_policy: "linear_elapsed_time",
    monthly_budget: { available: true, value: { amount: "100.00", currency: "USD" } },
    mtd_spend: { available: true, value: { amount: "60.00", currency: "USD" } },
    remaining: { available: true, value: { amount: "40.00", currency: "USD" } },
    elapsed_fraction: "0.483176",
    expected_spend_to_date: { available: true, value: { amount: "48.32", currency: "USD" } },
    variance: { available: true, value: { amount: "11.68", currency: "USD" } },
    projected_month_end_spend: { available: true, value: { amount: "124.18", currency: "USD" } },
  });
});

test("exact month start keeps zero progress and expected spend while only projection is unavailable", () => {
  const pacing = calculatePacing({
    scope,
    currency: "USD",
    timezone: "America/New_York",
    monthlyBudgetMinor: 10_000,
    mtdSpend: "0",
    asOf: "2026-03-01T05:00:00.000Z",
  });
  assert.equal(pacing.availability, "available");
  if (pacing.availability !== "available") assert.fail("expected available pacing");
  assert.equal(pacing.elapsed_fraction, "0.000000");
  assert.deepEqual(pacing.expected_spend_to_date, { available: true, value: { amount: "0.00", currency: "USD" } });
  assert.deepEqual(pacing.projected_month_end_spend, {
    available: false,
    reason: "month_just_started",
    detail: "Projection is unavailable at the exact start of the reporting month",
  });
});

test("missing timezone retains budget and currency but marks every dependent field unavailable", () => {
  const pacing = calculatePacing({
    scope: scopeWithoutTimezone,
    currency: "USD",
    monthlyBudgetMinor: 10_000,
    mtdSpend: "12.34",
    asOf: "2026-08-19T12:00:00.000Z",
  });
  assert.deepEqual(pacing.monthly_budget, { available: true, value: { amount: "100.00", currency: "USD" } });
  assert.equal(pacing.availability, "unavailable");
  assert.equal("timezone" in pacing, false);
  for (const field of [
    "reporting_month",
    "mtd_spend",
    "remaining",
    "elapsed_fraction",
    "expected_spend_to_date",
    "variance",
    "projected_month_end_spend",
  ] as const) {
    assert.deepEqual(pacing[field], {
      available: false,
      reason: "timezone_unavailable",
      detail: "Meta account timezone is unavailable",
    });
  }
});

test("missing spend preserves expected pacing while overspend remains negative", () => {
  const missing = calculatePacing({
    scope,
    currency: "USD",
    timezone: "America/New_York",
    monthlyBudgetMinor: 10_000,
    asOf: "2026-03-16T04:00:00.000Z",
  });
  assert.equal(missing.availability, "available");
  if (missing.availability !== "available") assert.fail("expected available pacing");
  assert.deepEqual(missing.expected_spend_to_date, { available: true, value: { amount: "48.32", currency: "USD" } });
  for (const field of ["mtd_spend", "remaining", "variance", "projected_month_end_spend"] as const) {
    assert.equal(missing[field].available, false);
    assert.equal((missing[field] as { reason: string }).reason, "spend_unavailable");
  }

  const overspent = calculatePacing({
    scope,
    currency: "USD",
    timezone: "America/New_York",
    monthlyBudgetMinor: 10_000,
    mtdSpend: "125.005",
    asOf: "2026-03-16T04:00:00.000Z",
  });
  assert.equal(overspent.availability, "available");
  if (overspent.availability !== "available") assert.fail("expected available pacing");
  assert.deepEqual(overspent.mtd_spend, { available: true, value: { amount: "125.00", currency: "USD" } });
  assert.deepEqual(overspent.remaining, { available: true, value: { amount: "-25.00", currency: "USD" } });
});

test("ISO currency precision handles zero and three decimal currencies and rejects unknown codes", () => {
  const jpy = calculatePacing({
    scope: { ...scope, currency: "JPY" },
    currency: "JPY",
    timezone: "Asia/Tokyo",
    monthlyBudgetMinor: 10_000,
    mtdSpend: "100.5",
    asOf: "2026-08-19T12:00:00.000Z",
  });
  assert.equal(jpy.availability, "available");
  if (jpy.availability !== "available") assert.fail("expected available pacing");
  assert.deepEqual(jpy.mtd_spend, { available: true, value: { amount: "100", currency: "JPY" } });

  const kwd = calculatePacing({
    scope: { ...scope, currency: "KWD" },
    currency: "KWD",
    timezone: "Asia/Kuwait",
    monthlyBudgetMinor: 12_345,
    mtdSpend: "1.2345",
    asOf: "2026-08-19T12:00:00.000Z",
  });
  assert.equal(kwd.availability, "available");
  if (kwd.availability !== "available") assert.fail("expected available pacing");
  assert.deepEqual(kwd.monthly_budget, { available: true, value: { amount: "12.345", currency: "KWD" } });
  assert.deepEqual(kwd.mtd_spend, { available: true, value: { amount: "1.234", currency: "KWD" } });

  assert.throws(
    () => calculatePacing({ scope, currency: "ZZZ", timezone: "UTC", monthlyBudgetMinor: 1, asOf: "2026-08-19T12:00:00.000Z" }),
    /unsupported currency/i,
  );
});

test("pacing rejects every noncanonical Meta spend form before Decimal parsing", () => {
  for (const mtdSpend of ["0x10", "0b10", "+1.25", "1e2", " 1.25", "1.25 ", "01.25", ".5", "1."]) {
    assert.throws(
      () => calculatePacing({
        scope,
        currency: "USD",
        timezone: "America/New_York",
        monthlyBudgetMinor: 10_000,
        mtdSpend,
        asOf: "2026-08-19T12:00:00.000Z",
      }),
      /invalid month-to-date spend/i,
      mtdSpend,
    );
  }
  for (const mtdSpend of ["0", "0.00", "1.25", "100000000000000000000.000001"]) {
    const pacing = calculatePacing({
      scope,
      currency: "USD",
      timezone: "America/New_York",
      monthlyBudgetMinor: 10_000,
      mtdSpend,
      asOf: "2026-08-19T12:00:00.000Z",
    });
    assert.equal(pacing.availability, "available", mtdSpend);
  }
});

test("runtime pacing variants satisfy their generated OpenAPI discriminator types", () => {
  const available = calculatePacing({
    scope,
    currency: "USD",
    timezone: "America/New_York",
    monthlyBudgetMinor: 10_000,
    mtdSpend: "25.00",
    asOf: "2026-08-19T12:00:00.000Z",
  });
  if (available.availability !== "available") assert.fail("expected available pacing");
  const typedAvailable: components["schemas"]["BudgetPacingAvailable"] = available;
  assert.equal(typedAvailable.availability, "available");

  const unavailable = calculatePacing({
    scope: scopeWithoutTimezone,
    currency: "USD",
    monthlyBudgetMinor: 10_000,
    asOf: "2026-08-19T12:00:00.000Z",
  });
  if (unavailable.availability !== "unavailable") assert.fail("expected unavailable pacing");
  const typedUnavailable: components["schemas"]["BudgetPacingTimezoneUnavailable"] = unavailable;
  assert.equal(typedUnavailable.availability, "unavailable");
});

function seed(db: ReturnType<typeof openDatabase>) {
  db.prepare("INSERT INTO clients (id, name, portfolio_id) VALUES (?, ?, ?)").run("client-1", "Client One", "portfolio-1");
  db.prepare("INSERT INTO integrations (id, name, meta_app_id, state) VALUES (?, ?, ?, ?)").run("integration-1", "Agency App", "app-1", "active");
  db.prepare("INSERT INTO integration_generations (id, integration_id, generation, status, validated_at) VALUES (?, ?, ?, ?, ?)").run(
    "generation-1", "integration-1", "2026-08", "active", "2026-08-19T12:00:00.000Z",
  );
  db.prepare("INSERT INTO ad_accounts (id, client_id, name, currency, timezone) VALUES (?, ?, ?, ?, ?)").run(
    "act_1", "client-1", "Account One", "USD", "America/New_York",
  );
  db.prepare(`INSERT INTO scope_mappings
    (client_id, ad_account_id, generation_id, active, app_authorized, subject_authorized, partner_authorized, asset_authorized, granted_tasks)
    VALUES (?, ?, ?, 1, 1, 1, 1, 1, ?)`).run("client-1", "act_1", "generation-1", JSON.stringify(["ADVERTISE"]));
  db.prepare(`INSERT INTO encrypted_credentials
    (id, generation_id, subject_id, key_ref, envelope_version, ciphertext, iv, auth_tag, scopes, status, validated_at)
    VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, 'active', ?)`).run(
    "credential-1", "generation-1", "subject-1", "database-key", "ciphertext", "iv", "tag", JSON.stringify(["ads_read"]), "2026-08-19T12:00:00.000Z",
  );
  db.prepare("INSERT INTO budgets (client_id, ad_account_id, amount_minor, currency, updated_at) VALUES (?, ?, ?, ?, ?)").run(
    "client-1", "act_1", 10_000, "USD", "2026-08-19T12:00:00.000Z",
  );
}

test("pacing service resolves scope, reads MTD spend, and returns an OpenAPI-valid handler response", async (t) => {
  const db = openDatabase(":memory:");
  seed(db);
  t.after(() => db.close());
  const calls: AsyncInsightsRequest[] = [];
  const meta: PacingMetaClient = {
    async request<T>(_input: MetaRequest) {
      return { data: {} as T, rate: {} };
    },
    async runAsyncInsights<T>(input: AsyncInsightsRequest) {
      calls.push(input);
      return [{ spend: "25.00" }] as T[];
    },
  };
  const service = createPacingService({ db, meta, now: () => new Date("2026-08-19T12:00:00.000Z") });
  const app = await buildApp({ serviceToken: "service-token", handlers: createPacingHandlers(service, "caller-1") });
  t.after(() => app.close());

  const response = await app.inject({
    method: "GET",
    url: "/v1/budget-pacing?client_id=client-1&ad_account_id=act_1&as_of=2026-08-19T12%3A00%3A00.000Z",
    headers: { authorization: "Bearer service-token", "x-request-id": "request-1234" },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().pacing.scope.ad_account_id, "act_1");
  assert.deepEqual(response.json().pacing.mtd_spend, { available: true, value: { amount: "25.00", currency: "USD" } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.scope.adAccountId, "act_1");
  assert.match(String(calls[0]!.query?.time_range), /2026-08-01/);

  const mismatch = await app.inject({
    method: "GET",
    url: "/v1/budget-pacing?client_id=other-client&ad_account_id=act_1",
    headers: { authorization: "Bearer service-token" },
  });
  assert.equal(mismatch.statusCode, 409);
  assert.equal(mismatch.headers["x-request-id"], mismatch.json().request_id);
});

test("pacing errors preserve the handler request ID passed to the service", async (t) => {
  let serviceRequestId = "";
  const service = {
    async getBudgetPacing(input: { requestId: string }) {
      serviceRequestId = input.requestId;
      throw new Error("Scope is not authorized");
    },
  } as Parameters<typeof createPacingHandlers>[0];
  const app = await buildApp({ serviceToken: "service-token", handlers: createPacingHandlers(service, "caller-1") });
  t.after(() => app.close());
  const response = await app.inject({
    method: "GET",
    url: "/v1/budget-pacing?client_id=other-client&ad_account_id=act_1",
    headers: { authorization: "Bearer service-token" },
  });
  assert.equal(response.statusCode, 409);
  assert.equal(response.headers["x-request-id"], response.json().request_id);
  assert.equal(serviceRequestId, response.json().request_id);
});
