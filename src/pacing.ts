import { Temporal } from "@js-temporal/polyfill";
import { Decimal } from "decimal.js";
import type { DatabaseSync } from "node:sqlite";
import type { Context, HandlerMap } from "openapi-backend";
import type { ContractResponse } from "./contract.js";
import { requestId } from "./request-id.js";
import type { components } from "./generated/openapi.js";
import { MetaError, type AsyncInsightsRequest, type MetaRequest } from "./meta-client.js";
import { resolveScope } from "./scope.js";

const Exact = Decimal.clone({ precision: 50, rounding: Decimal.ROUND_HALF_EVEN });
const currencies = new Set(Intl.supportedValuesOf("currency"));

type ScopeResponse = components["schemas"]["ResolvedScope"];
type Money = components["schemas"]["Money"];
type AvailableMoney = { available: true; value: Money };
type SpendUnavailable = { available: false; reason: "spend_unavailable"; detail: string };
type TimezoneUnavailable = { available: false; reason: "timezone_unavailable"; detail: string };
type Projection = AvailableMoney | SpendUnavailable | { available: false; reason: "month_just_started"; detail: string };

interface AvailablePacing {
  availability: "available";
  scope: PacingScope;
  timezone: string;
  currency: string;
  reporting_month: string;
  as_of: string;
  pacing_policy: "linear_elapsed_time";
  monthly_budget: AvailableMoney;
  mtd_spend: AvailableMoney | SpendUnavailable;
  remaining: AvailableMoney | SpendUnavailable;
  elapsed_fraction: string;
  expected_spend_to_date: AvailableMoney;
  variance: AvailableMoney | SpendUnavailable;
  projected_month_end_spend: Projection;
}

interface UnavailablePacing {
  availability: "unavailable";
  scope: PacingScope;
  currency: string;
  reporting_month: TimezoneUnavailable;
  as_of: string;
  pacing_policy: "linear_elapsed_time";
  monthly_budget: AvailableMoney;
  mtd_spend: TimezoneUnavailable;
  remaining: TimezoneUnavailable;
  elapsed_fraction: TimezoneUnavailable;
  expected_spend_to_date: TimezoneUnavailable;
  variance: TimezoneUnavailable;
  projected_month_end_spend: TimezoneUnavailable;
  reason: "timezone_unavailable";
  detail: string;
}

type Pacing = AvailablePacing | UnavailablePacing;

type PacingScope = ScopeResponse;

interface PacingInput {
  scope: PacingScope;
  currency: string;
  timezone?: string;
  monthlyBudgetMinor: number;
  mtdSpend?: string;
  asOf: string;
}

export interface PacingMetaClient {
  request<T = unknown>(input: MetaRequest): Promise<{ data: T; rate: unknown }>;
  runAsyncInsights<T>(input: AsyncInsightsRequest): Promise<T[]>;
}

interface PacingServiceOptions {
  db: DatabaseSync;
  meta: PacingMetaClient;
  now?: () => Date;
}

interface PacingRequest {
  actor: string;
  requestId: string;
  clientId: string;
  adAccountId: string;
  asOf?: string;
}

function currencyScale(currency: string): number {
  if (!/^[A-Z]{3}$/.test(currency) || !currencies.has(currency)) throw new Error(`Unsupported currency ${currency}`);
  return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
}

function amount(value: Decimal, currency: string, scale: number) {
  return { amount: value.toFixed(scale, Decimal.ROUND_HALF_EVEN), currency };
}

function available(value: components["schemas"]["Money"]) {
  return { available: true as const, value };
}

function spendUnavailable(detail: string) {
  return { available: false as const, reason: "spend_unavailable" as const, detail };
}

function timezoneUnavailable() {
  return {
    available: false as const,
    reason: "timezone_unavailable" as const,
    detail: "Meta account timezone is unavailable",
  };
}

interface Window {
  reportingMonth: string;
  since: string;
  until: string;
  elapsed: Decimal;
}

function reportingWindow(timezone: string, asOf: string): Window {
  const instant = Temporal.Instant.from(asOf);
  const zoned = instant.toZonedDateTimeISO(timezone);
  const start = Temporal.ZonedDateTime.from({
    timeZone: timezone,
    year: zoned.year,
    month: zoned.month,
    day: 1,
    hour: 0,
    minute: 0,
    second: 0,
    millisecond: 0,
    microsecond: 0,
    nanosecond: 0,
  });
  const end = start.add({ months: 1 });
  const elapsedNanoseconds = instant.epochNanoseconds - start.epochNanoseconds;
  const monthNanoseconds = end.epochNanoseconds - start.epochNanoseconds;
  const elapsed = new Exact(elapsedNanoseconds.toString()).div(monthNanoseconds.toString());
  return {
    reportingMonth: `${zoned.year.toString().padStart(4, "0")}-${zoned.month.toString().padStart(2, "0")}`,
    since: `${zoned.year.toString().padStart(4, "0")}-${zoned.month.toString().padStart(2, "0")}-01`,
    until: zoned.toPlainDate().toString(),
    elapsed,
  };
}

export function calculatePacing(input: PacingInput): Pacing {
  const scale = currencyScale(input.currency);
  if (!Number.isSafeInteger(input.monthlyBudgetMinor) || input.monthlyBudgetMinor < 0) throw new Error("Invalid monthly budget");
  const asOf = Temporal.Instant.from(input.asOf).toString({ smallestUnit: "millisecond" });
  const budget = new Exact(input.monthlyBudgetMinor).div(new Exact(10).pow(scale));
  const monthlyBudget = available(amount(budget, input.currency, scale));

  if (input.timezone === undefined) {
    const unavailable = timezoneUnavailable();
    return {
      availability: "unavailable",
      scope: input.scope,
      currency: input.currency,
      reporting_month: unavailable,
      as_of: asOf,
      pacing_policy: "linear_elapsed_time",
      monthly_budget: monthlyBudget,
      mtd_spend: unavailable,
      remaining: unavailable,
      elapsed_fraction: unavailable,
      expected_spend_to_date: unavailable,
      variance: unavailable,
      projected_month_end_spend: unavailable,
      reason: "timezone_unavailable",
      detail: "Meta account timezone is unavailable",
    };
  }

  const window = reportingWindow(input.timezone, asOf);
  const expected = budget.times(window.elapsed);
  const expectedAvailable = available(amount(expected, input.currency, scale));
  const elapsedFraction = window.elapsed.toFixed(6, Decimal.ROUND_HALF_EVEN);
  const base = {
    availability: "available" as const,
    scope: input.scope,
    timezone: input.timezone,
    currency: input.currency,
    reporting_month: window.reportingMonth,
    as_of: asOf,
    pacing_policy: "linear_elapsed_time" as const,
    monthly_budget: monthlyBudget,
    elapsed_fraction: elapsedFraction,
    expected_spend_to_date: expectedAvailable,
  };

  if (input.mtdSpend === undefined) {
    const unavailable = spendUnavailable("Meta did not report month-to-date spend");
    return {
      ...base,
      mtd_spend: unavailable,
      remaining: unavailable,
      variance: unavailable,
      projected_month_end_spend: unavailable,
    };
  }

  let spend: Decimal;
  try {
    if (!/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(input.mtdSpend)) throw new Error();
    spend = new Exact(input.mtdSpend).toDecimalPlaces(scale, Decimal.ROUND_HALF_EVEN);
  } catch {
    throw new Error("Invalid month-to-date spend");
  }
  if (!spend.isFinite() || spend.isNegative()) throw new Error("Invalid month-to-date spend");
  const mtdSpend = available(amount(spend, input.currency, scale));
  const remaining = available(amount(budget.minus(spend), input.currency, scale));
  const variance = available(amount(spend.minus(expected), input.currency, scale));
  const projection = window.elapsed.isZero()
    ? {
        available: false as const,
        reason: "month_just_started" as const,
        detail: "Projection is unavailable at the exact start of the reporting month",
      }
    : available(amount(spend.div(window.elapsed), input.currency, scale));
  return { ...base, mtd_spend: mtdSpend, remaining, variance, projected_month_end_spend: projection };
}

export function createPacingService({ db, meta, now = () => new Date() }: PacingServiceOptions) {
  async function getBudgetPacing(input: PacingRequest) {
    const scope = resolveScope(
      db,
      { clientId: input.clientId, adAccountId: input.adAccountId },
      { permission: "ads_read" },
    );
    const budget = db
      .prepare("SELECT amount_minor, currency FROM budgets WHERE client_id = ? AND ad_account_id = ?")
      .get(scope.clientId, scope.adAccountId) as { amount_minor: number; currency: string } | undefined;
    if (budget === undefined) throw new Error("Budget is not configured");
    const asOf = input.asOf ?? now().toISOString();
    const responseScope: ScopeResponse = {
      client_id: scope.clientId,
      client_name: scope.clientName,
      ad_account_id: scope.adAccountId,
      ad_account_name: scope.adAccountName,
      ...(scope.currency === undefined ? {} : { currency: scope.currency }),
      ...(scope.timezone === undefined ? {} : { timezone: scope.timezone }),
    };
    if (scope.timezone === undefined) {
      return { request_id: input.requestId, pacing: calculatePacing({ scope: responseScope, currency: budget.currency, monthlyBudgetMinor: budget.amount_minor, asOf }) };
    }

    const window = reportingWindow(scope.timezone, asOf);
    const rows = await meta.runAsyncInsights<Record<string, unknown>>({
      path: `/${scope.adAccountId}/insights`,
      query: {
        level: "account",
        time_range: JSON.stringify({ since: window.since, until: window.until }),
        fields: "spend",
      },
      scope,
      actor: input.actor,
      correlationId: input.requestId,
      operation: "get_budget_pacing",
    });
    const rawSpend = rows[0]?.spend;
    const mtdSpend = typeof rawSpend === "string" ? rawSpend : undefined;
    return {
      request_id: input.requestId,
      pacing: calculatePacing({
        scope: responseScope,
        currency: budget.currency,
        timezone: scope.timezone,
        monthlyBudgetMinor: budget.amount_minor,
        ...(mtdSpend === undefined ? {} : { mtdSpend }),
        asOf,
      }),
    };
  }
  return { getBudgetPacing };
}

export type PacingService = ReturnType<typeof createPacingService>;

function problem(context: Context, id: string, error: unknown): ContractResponse {
  const message = error instanceof Error ? error.message : "";
  const meta = error instanceof MetaError;
  const status = meta ? (error.status === 429 ? 429 : 502) : /scope/i.test(message) ? 409 : /budget/i.test(message) ? 404 : 400;
  const code = status === 429 ? "rate_limited" : status === 502 ? "meta_error" : status === 409 ? "client_account_mismatch" : status === 404 ? "not_found" : "validation_error";
  const title = status === 502 ? "Upstream error" : status === 429 ? "Rate limited" : status === 409 ? "Scope conflict" : status === 404 ? "Not found" : "Bad request";
  const query = context.request.query as Record<string, unknown>;
  return {
    statusCode: status,
    mediaType: "application/problem+json",
    headers: { "x-request-id": id, ...(status === 429 && meta && error.retryAfterSeconds !== undefined ? { "retry-after": String(error.retryAfterSeconds) } : {}) },
    body: {
      type: `urn:fb-marketing-server:${code}`,
      title,
      status,
      code,
      detail: title,
      request_id: id,
      ...(status === 409 ? { supplied_scope: { client_id: String(query.client_id), ad_account_id: String(query.ad_account_id) } } : {}),
    },
  };
}

export function createPacingHandlers(service: PacingService, actor: string): HandlerMap {
  return {
    getBudgetPacing: async (context: Context) => {
      const id = requestId(context.request.headers["x-request-id"]);
      const query = context.request.query as Record<string, unknown>;
      try {
        const body = await service.getBudgetPacing({
          actor,
          requestId: id,
          clientId: String(query.client_id),
          adAccountId: String(query.ad_account_id),
          ...(typeof query.as_of === "string" ? { asOf: query.as_of } : {}),
        });
        return { statusCode: 200, mediaType: "application/json", headers: { "x-request-id": id }, body } satisfies ContractResponse;
      } catch (error) {
        return problem(context, id, error);
      }
    },
  };
}
