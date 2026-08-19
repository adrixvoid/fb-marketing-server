import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { Context, HandlerMap } from "openapi-backend";
import type { ContractResponse } from "./contract.js";
import type { components } from "./generated/openapi.js";
import { MetaError, type AsyncInsightsRequest, type MetaPageRequest, type MetaRequest } from "./meta-client.js";
import { resolveScope, type ResolvedScope } from "./scope.js";

type ScopeResponse = components["schemas"]["ResolvedScope"];
type CapabilityAsset = components["schemas"]["CapabilityAsset"];
type Diagnostic = components["schemas"]["Diagnostic"];
type InsightMetrics = components["schemas"]["InsightMetrics"];
type InsightRow = components["schemas"]["InsightRow"];
type Level = "account" | "campaign" | "ad_set" | "ad";
type AssetType = "page" | "pixel" | "web_dataset" | "lead_form" | "instagram_account";

export interface ReportingMetaClient {
  request<T = unknown>(input: MetaRequest): Promise<{ data: T; rate: unknown }>;
  paginate<T>(input: MetaPageRequest): Promise<T[]>;
  runAsyncInsights<T>(input: AsyncInsightsRequest): Promise<T[]>;
}

interface ReportingOptions {
  db: DatabaseSync;
  meta: ReportingMetaClient;
  cursorKey: Buffer;
  now?: () => Date;
}

interface RequestBase {
  actor: string;
  requestId: string;
}

interface ScopedRequest extends RequestBase {
  clientId: string;
  adAccountId: string;
}

interface PageRequest extends RequestBase {
  cursor?: string;
  limit: number;
}

interface CursorPayload {
  actor: string;
  scope: string;
  filter: string;
  position: string | number;
}

class ReportingError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 409 | 422,
    readonly code: "cursor_mismatch" | "client_account_mismatch" | "unsupported_query" | "validation_error",
    readonly supplied?: { client_id?: string; ad_account_id?: string },
  ) {
    super(message);
  }
}

function resolved(scope: ResolvedScope): ScopeResponse {
  return {
    client_id: scope.clientId,
    client_name: scope.clientName,
    ad_account_id: scope.adAccountId,
    ad_account_name: scope.adAccountName,
    ...(scope.currency === undefined ? {} : { currency: scope.currency }),
    ...(scope.timezone === undefined ? {} : { timezone: scope.timezone }),
  };
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function pageLimit(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 100) throw new ReportingError("Invalid limit", 400, "validation_error");
  return value;
}

function cursorCodec(key: Buffer) {
  if (key.length < 32) throw new Error("Cursor key must contain at least 32 bytes");
  const sign = (payload: string) => createHmac("sha256", key).update(payload).digest();
  return {
    encode(value: CursorPayload): string {
      const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
      return `${payload}.${sign(payload).toString("base64url")}`;
    },
    decode(token: string, binding: Omit<CursorPayload, "position">): string | number {
      try {
        const [payload, signature, extra] = token.split(".");
        if (!payload || !signature || extra !== undefined) throw new Error();
        const supplied = Buffer.from(signature, "base64url");
        const expected = sign(payload);
        if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new Error();
        const value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as CursorPayload;
        if (
          value === null ||
          typeof value !== "object" ||
          Object.keys(value).length !== 4 ||
          value.actor !== binding.actor ||
          value.scope !== binding.scope ||
          value.filter !== binding.filter ||
          !(
            (typeof value.position === "number" && Number.isSafeInteger(value.position) && value.position >= 0) ||
            (typeof value.position === "string" && value.position.length > 0 && value.position.length <= 4_096)
          )
        ) {
          throw new Error();
        }
        return value.position;
      } catch {
        throw new ReportingError("Cursor binding does not match the request", 400, "cursor_mismatch");
      }
    },
  };
}

function localPage<T>(
  values: T[],
  input: PageRequest,
  binding: Omit<CursorPayload, "position">,
  cursors: ReturnType<typeof cursorCodec>,
) {
  const limit = pageLimit(input.limit);
  const position = input.cursor === undefined ? 0 : cursors.decode(input.cursor, binding);
  if (typeof position !== "number") throw new ReportingError("Cursor binding does not match the request", 400, "cursor_mismatch");
  const data = values.slice(position, position + limit);
  const next = position + data.length;
  return {
    data,
    page: { next_cursor: next < values.length ? cursors.encode({ ...binding, position: next }) : null },
  };
}

function integrationState(value: string): components["schemas"]["IntegrationState"] {
  return ["registered", "validating", "active", "configuration_required", "reauthorization_required", "asset_access_required"].includes(value)
    ? (value as components["schemas"]["IntegrationState"])
    : "configuration_required";
}

interface IntegrationRow {
  integration_id: string;
  generation: string;
  state: string;
  scopes: string | null;
}

function integration(db: DatabaseSync, now: Date, generationId?: string, requiredPermissions: readonly string[] = ["ads_read"]) {
  const row = db
    .prepare(`
      SELECT i.id AS integration_id, g.generation, i.state, ec.scopes
        FROM integrations i
        JOIN integration_generations g ON g.integration_id = i.id
        LEFT JOIN encrypted_credentials ec ON ec.generation_id = g.id AND ec.status = 'active'
       WHERE i.active = 1 AND g.status = 'active'
         AND (? IS NULL OR g.id = ?)
       ORDER BY i.id, g.generation
       LIMIT 1
    `)
    .get(generationId ?? null, generationId ?? null) as unknown as IntegrationRow | undefined;
  if (row === undefined) {
    return {
      integration_id: "unconfigured",
      generation: "unconfigured",
      state: "configuration_required" as const,
      checked_at: now.toISOString(),
      missing_permissions: [...requiredPermissions],
      diagnostics: [gap("integration_unconfigured", "No Meta integration is configured", "Seed and validate an integration outside the model-facing API")],
    };
  }
  const scopes = row.scopes === null ? [] : JSON.parse(row.scopes) as unknown;
  const granted = new Set(Array.isArray(scopes) ? scopes.filter((value): value is string => typeof value === "string") : []);
  const missing = [...new Set(requiredPermissions)].filter((permission) => !granted.has(permission));
  const diagnostics: Diagnostic[] = missing.length === 0
    ? []
    : [{ code: "permission_missing", message: "Required Meta permission is missing", remediation: "Grant ads_read and revalidate the credential" }];
  return {
    integration_id: row.integration_id,
    generation: row.generation,
    state: missing.length === 0 ? integrationState(row.state) : "reauthorization_required" as const,
    checked_at: now.toISOString(),
    missing_permissions: missing,
    diagnostics,
  };
}

function assetId(asset: CapabilityAsset): string {
  if ("page_id" in asset && asset.asset_type === "page") return asset.page_id;
  if ("pixel_id" in asset) return asset.pixel_id;
  if ("lead_gen_form_id" in asset) return asset.lead_gen_form_id;
  return asset.instagram_account_id;
}

function collection(value: unknown): Record<string, unknown>[] {
  if (value === null || typeof value !== "object" || !("data" in value) || !Array.isArray((value as { data?: unknown }).data)) return [];
  return (value as { data: unknown[] }).data.filter(
    (item): item is Record<string, unknown> => item !== null && typeof item === "object" && !Array.isArray(item),
  );
}

function text(row: Record<string, unknown>, field: string): string | undefined {
  const value = row[field];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function capabilityAssets(raw: Record<string, unknown>, filter?: AssetType): CapabilityAsset[] {
  const assets: CapabilityAsset[] = [];
  for (const row of collection(raw.promote_pages)) {
    const pageId = text(row, "id");
    const name = text(row, "name");
    if (pageId && name) assets.push({ asset_type: "page", page_id: pageId, name });
  }
  for (const row of collection(raw.adspixels)) {
    const pixelId = text(row, "id");
    const name = text(row, "name");
    if (pixelId && name) assets.push({ asset_type: "pixel", pixel_id: pixelId, name });
  }
  for (const row of collection(raw.datasets)) {
    const pixelId = text(row, "id");
    const name = text(row, "name");
    if (pixelId && name) assets.push({ asset_type: "web_dataset", pixel_id: pixelId, name });
  }
  for (const row of collection(raw.leadgen_forms)) {
    const formId = text(row, "id");
    const pageId = text(row, "page_id");
    const name = text(row, "name");
    if (formId && pageId && name && row.status === "ACTIVE") {
      assets.push({ asset_type: "lead_form", lead_gen_form_id: formId, page_id: pageId, name, published: true, usable: true });
    }
  }
  for (const row of collection(raw.instagram_accounts)) {
    const instagramId = text(row, "id");
    const name = text(row, "name");
    const pageId = text(row, "page_id");
    if (instagramId && name) {
      assets.push({ asset_type: "instagram_account", instagram_account_id: instagramId, name, ...(pageId ? { page_id: pageId } : {}) });
    }
  }
  return assets
    .filter(({ asset_type }) => filter === undefined || asset_type === filter)
    .sort((a, b) => a.asset_type.localeCompare(b.asset_type) || assetId(a).localeCompare(assetId(b)));
}

function gap(code: string, message: string, remediation: string): Diagnostic {
  return { code, message, remediation };
}

function capabilityCheck(codes: string[]) {
  return { status: codes.length === 0 ? "available" as const : "unavailable" as const, diagnostic_codes: [...new Set(codes)] };
}

function minorUnit(currency: string): number {
  return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
}

function roundDecimal(value: unknown, scale: number): string | undefined {
  if (typeof value !== "string" || !/^-?\d+(?:\.\d+)?$/.test(value)) return undefined;
  const negative = value.startsWith("-");
  const [integer, originalFraction = ""] = (negative ? value.slice(1) : value).split(".");
  const fraction = originalFraction.padEnd(scale + 1, "0");
  let kept = BigInt(`${integer}${fraction.slice(0, scale) || ""}`);
  const discarded = fraction.slice(scale);
  if (discarded[0]! > "5" || (discarded[0] === "5" && (/[1-9]/.test(discarded.slice(1)) || kept % 2n === 1n))) kept += 1n;
  const digits = kept.toString().padStart(scale + 1, "0");
  const formatted = scale === 0 ? digits : `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
  return negative && kept !== 0n ? `-${formatted}` : formatted;
}

function money(value: unknown, currency: string) {
  const amount = roundDecimal(value, minorUnit(currency));
  return amount === undefined ? undefined : { amount, currency };
}

function minorMoney(value: unknown, currency: string) {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return undefined;
  const scale = minorUnit(currency);
  const digits = BigInt(value).toString().padStart(scale + 1, "0");
  return { amount: scale === 0 ? digits : `${digits.slice(0, -scale)}.${digits.slice(-scale)}`, currency };
}

function unavailable(reason: components["schemas"]["MetricUnavailable"]["reason"], detail: string) {
  return { available: false as const, reason, detail };
}

function decimalMetric(value: unknown, name: string) {
  const rounded = roundDecimal(value, 6);
  return rounded === undefined
    ? unavailable("value_not_reported", `Meta did not report ${name}`)
    : { available: true as const, value: rounded };
}

function integerMetric(value: unknown, name: string) {
  if (typeof value !== "string" || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) {
    return unavailable("value_not_reported", `Meta did not report ${name}`);
  }
  return { available: true as const, value: Number(value) };
}

function moneyMetric(value: unknown, currency: string, name: string) {
  const normalized = money(value, currency);
  return normalized === undefined
    ? unavailable("value_not_reported", `Meta did not report ${name}`)
    : { available: true as const, value: normalized };
}

function arrayValue(value: unknown): unknown {
  return Array.isArray(value) && value[0] !== null && typeof value[0] === "object"
    ? (value[0] as { value?: unknown }).value
    : undefined;
}

function insightMetrics(row: Record<string, unknown>, currency: string): InsightMetrics {
  const roas = roundDecimal(arrayValue(row.purchase_roas), 6);
  return {
    spend: moneyMetric(row.spend, currency, "spend"),
    impressions: integerMetric(row.impressions, "impressions"),
    reach: integerMetric(row.reach, "reach"),
    clicks: integerMetric(row.clicks, "clicks"),
    ctr: decimalMetric(row.ctr, "CTR"),
    cpc: moneyMetric(row.cpc, currency, "CPC"),
    cpm: moneyMetric(row.cpm, currency, "CPM"),
    results: decimalMetric(row.results, "results"),
    conversions: decimalMetric(row.conversions, "conversions"),
    cost_per_result: moneyMetric(row.cost_per_result, currency, "cost per result"),
    roas: roas === undefined
      ? unavailable("value_data_missing", "Meta did not report ROAS value data")
      : { available: true, value: roas },
  };
}

function insightRow(row: Record<string, unknown>, level: Level, currency: string, fallbackRange: { since: string; until: string }): InsightRow | undefined {
  const prefix = level === "ad_set" ? "adset" : level;
  const entityId = text(row, `${prefix}_id`);
  const entityName = text(row, `${prefix}_name`);
  if (!entityId || entityName === undefined) return undefined;
  return {
    entity_id: entityId,
    entity_name: entityName,
    date_range: { since: text(row, "date_start") ?? fallbackRange.since, until: text(row, "date_stop") ?? fallbackRange.until },
    metrics: insightMetrics(row, currency),
  };
}

function scopeOrConflict(db: DatabaseSync, input: ScopedRequest, permission: string | undefined = "ads_read"): ResolvedScope {
  try {
    return resolveScope(
      db,
      { clientId: input.clientId, adAccountId: input.adAccountId },
      permission === undefined ? {} : { permission },
    );
  } catch {
    throw new ReportingError("Scope is not authorized", 409, "client_account_mismatch", {
      client_id: input.clientId,
      ad_account_id: input.adAccountId,
    });
  }
}

export function createReportingService({ db, meta, cursorKey, now = () => new Date() }: ReportingOptions) {
  const cursors = cursorCodec(cursorKey);

  function scopeAuthority(scope: ResolvedScope) {
    const row = db.prepare(`
      SELECT sm.granted_tasks, ec.scopes
        FROM scope_mappings sm
        JOIN encrypted_credentials ec ON ec.generation_id = sm.generation_id AND ec.id = ?
       WHERE sm.client_id = ? AND sm.ad_account_id = ? AND sm.generation_id = ?
    `).get(scope.credentialId, scope.clientId, scope.adAccountId, scope.generationId) as { granted_tasks: string; scopes: string } | undefined;
    const safeValues = (value: string | undefined) => {
      const parsed = value === undefined ? [] : JSON.parse(value) as unknown;
      return new Set(
        Array.isArray(parsed)
          ? parsed.filter((item): item is string => typeof item === "string" && /^[a-zA-Z][a-zA-Z0-9_]{1,127}$/.test(item))
          : [],
      );
    };
    return { tasks: safeValues(row?.granted_tasks), permissions: safeValues(row?.scopes) };
  }

  function listScopes(input: PageRequest) {
    const rows = db.prepare(`
      SELECT c.id AS client_id, c.name AS client_name, a.id AS ad_account_id, a.name AS ad_account_name, a.currency, a.timezone
        FROM scope_mappings sm
        JOIN clients c ON c.id = sm.client_id AND c.active = 1
        JOIN ad_accounts a ON a.id = sm.ad_account_id AND a.client_id = c.id AND a.active = 1
        JOIN integration_generations g ON g.id = sm.generation_id AND g.status = 'active' AND g.validated_at IS NOT NULL AND g.retired_at IS NULL
        JOIN integrations i ON i.id = g.integration_id AND i.active = 1 AND i.state = 'active'
        JOIN encrypted_credentials ec ON ec.generation_id = g.id AND ec.status = 'active' AND ec.validated_at IS NOT NULL AND ec.revoked_at IS NULL
       WHERE sm.active = 1 AND sm.app_authorized = 1 AND sm.subject_authorized = 1 AND sm.partner_authorized = 1 AND sm.asset_authorized = 1
       ORDER BY c.id, a.id
    `).all().map((row) => ({
      client_id: String(row.client_id), client_name: String(row.client_name),
      ad_account_id: String(row.ad_account_id), ad_account_name: String(row.ad_account_name),
      ...(row.currency === null ? {} : { currency: String(row.currency) }),
      ...(row.timezone === null ? {} : { timezone: String(row.timezone) }),
    }));
    const page = localPage(rows, input, { actor: input.actor, scope: "", filter: hash({ operation: "list_scopes", limit: input.limit }) }, cursors);
    return { request_id: input.requestId, ...page };
  }

  function getIntegrationStatus(input: RequestBase & Partial<Pick<ScopedRequest, "clientId" | "adAccountId">>) {
    if ((input.clientId === undefined) !== (input.adAccountId === undefined)) {
      throw new ReportingError("Both scope identifiers are required together", 400, "validation_error", {
        ...(input.clientId === undefined ? {} : { client_id: input.clientId }),
        ...(input.adAccountId === undefined ? {} : { ad_account_id: input.adAccountId }),
      });
    }
    const scope = input.clientId === undefined
      ? undefined
      : scopeOrConflict(db, { ...input, clientId: input.clientId, adAccountId: input.adAccountId! });
    return {
      request_id: input.requestId,
      ...(scope === undefined ? {} : { scope: resolved(scope) }),
      integration: integration(db, now(), scope?.generationId),
    };
  }

  async function getCapabilities(input: ScopedRequest & PageRequest & { assetType?: AssetType }) {
    const scope = scopeOrConflict(db, input, undefined);
    const metadata = await meta.request<Record<string, unknown>>({
      method: "GET",
      path: `/${scope.adAccountId}`,
      query: { fields: "currency,timezone_name" },
      scope,
      actor: input.actor,
      correlationId: input.requestId,
      operation: "get_capabilities",
    });
    const edgeGaps = new Map<string, Diagnostic>();
    const edge = async (name: string, fields: string, gapCode: string) => {
      try {
        return await meta.paginate<Record<string, unknown>>({
          path: `/${scope.adAccountId}/${name}`,
          query: { fields },
          scope,
          actor: input.actor,
          correlationId: input.requestId,
          operation: `get_capabilities_${name === "promote_pages" ? "pages" : name}`,
        });
      } catch (error) {
        if (error instanceof MetaError && ["repeated_cursor", "page_limit", "invalid_cursor"].includes(error.code)) throw error;
        edgeGaps.set(gapCode, gap(gapCode, `${name} access is unavailable`, `Grant the required permission and asset assignment for ${name}`));
        return [];
      }
    };
    const [pages, pixels, datasets, forms, instagram] = await Promise.all([
      edge("promote_pages", "id,name", "page_access_missing"),
      edge("adspixels", "id,name", "pixel_access_missing"),
      edge("datasets", "id,name", "web_dataset_access_missing"),
      edge("leadgen_forms", "id,name,page_id,status", "lead_form_access_missing"),
      edge("instagram_accounts", "id,name,page_id", "instagram_account_access_missing"),
    ]);
    const rawAssets = {
      promote_pages: { data: pages },
      adspixels: { data: pixels },
      datasets: { data: datasets },
      leadgen_forms: { data: forms },
      instagram_accounts: { data: instagram },
    };
    const assets = capabilityAssets(rawAssets, input.assetType);
    const allAssets = capabilityAssets(rawAssets);
    const hasPage = allAssets.some(({ asset_type }) => asset_type === "page");
    const hasTracking = allAssets.some(({ asset_type }) => asset_type === "pixel" || asset_type === "web_dataset");
    const hasForm = allAssets.some(({ asset_type }) => asset_type === "lead_form");
    const hasInstagram = allAssets.some(({ asset_type }) => asset_type === "instagram_account");
    const currency = typeof metadata.data.currency === "string" ? metadata.data.currency : scope.currency ?? null;
    const timezone = typeof metadata.data.timezone_name === "string" ? metadata.data.timezone_name : null;
    const gaps = new Map(edgeGaps);
    const addGap = (diagnostic: Diagnostic) => gaps.set(diagnostic.code, diagnostic);
    if (currency === null) addGap(gap("account_currency_unavailable", "Account currency is unavailable", "Configure and revalidate the Meta Ad Account currency"));
    if (timezone === null) addGap(gap("account_timezone_unavailable", "Account timezone is unavailable", "Configure and revalidate the Meta Ad Account timezone"));
    if (!hasPage && !gaps.has("page_access_missing")) addGap(gap("page_unavailable", "No accessible Page is available", "Assign an accessible Page to the integration"));
    if (!hasTracking && !gaps.has("pixel_access_missing") && !gaps.has("web_dataset_access_missing")) addGap(gap("tracking_asset_unavailable", "No accessible pixel or web dataset is available", "Assign a pixel or web dataset to the integration"));
    if (!hasForm && !gaps.has("lead_form_access_missing")) addGap(gap("lead_form_unavailable", "No published usable lead form is available", "Publish and assign a usable Page lead form"));
    if (!hasInstagram && !gaps.has("instagram_account_access_missing")) addGap(gap("instagram_account_unavailable", "No relevant Instagram account is available", "Assign an Instagram account to an accessible Page"));
    const authority = scopeAuthority(scope);
    const requiredPermissions = ["ads_read", "ads_management", "pages_read_engagement", "leads_retrieval", "instagram_basic"];
    for (const permission of requiredPermissions) {
      if (!authority.permissions.has(permission)) {
        const code = `${permission}_permission_missing`;
        addGap(gap(code, `Required Meta permission ${permission} is missing`, `Grant ${permission} and revalidate the credential`));
      }
    }
    if (!authority.tasks.has("ADVERTISE")) addGap(gap("advertise_task_missing", "Required ADVERTISE asset task is missing", "Assign the ADVERTISE task and revalidate the asset"));
    const missingPermissionCodes = (permissions: readonly string[]) => permissions
      .filter((permission) => !authority.permissions.has(permission))
      .map((permission) => `${permission}_permission_missing`);
    const taskCodes = authority.tasks.has("ADVERTISE") ? [] : ["advertise_task_missing"];
    const pageCodes = hasPage ? [] : [gaps.has("page_access_missing") ? "page_access_missing" : "page_unavailable"];
    const trackingCodes = hasTracking ? [] : [gaps.has("pixel_access_missing") ? "pixel_access_missing" : gaps.has("web_dataset_access_missing") ? "web_dataset_access_missing" : "tracking_asset_unavailable"];
    const formCodes = hasForm ? [] : [gaps.has("lead_form_access_missing") ? "lead_form_access_missing" : "lead_form_unavailable"];
    const instagramCodes = hasInstagram ? [] : [gaps.has("instagram_account_access_missing") ? "instagram_account_access_missing" : "instagram_account_unavailable"];
    const commonCampaignCodes = [
      ...missingPermissionCodes(["ads_management", "pages_read_engagement", "instagram_basic"]),
      ...taskCodes,
      ...pageCodes,
      ...instagramCodes,
    ];
    const page = localPage(
      assets,
      input,
      { actor: input.actor, scope: `${scope.clientId}:${scope.adAccountId}`, filter: hash({ assetType: input.assetType ?? null, limit: input.limit }) },
      cursors,
    );
    return {
      request_id: input.requestId,
      scope: resolved(scope),
      integration: integration(db, now(), scope.generationId, requiredPermissions),
      account: { currency, timezone },
      supported_campaign_kinds: ["SALES_WEBSITE", "LEADS_WEBSITE", "LEADS_INSTANT_FORM"] as const,
      assets: page.data,
      page: page.page,
      capabilities: {
        reads: capabilityCheck(missingPermissionCodes(["ads_read"])),
        sales_website: capabilityCheck([...commonCampaignCodes, ...trackingCodes]),
        leads_website: capabilityCheck([...commonCampaignCodes, ...trackingCodes]),
        leads_instant_form: capabilityCheck([...commonCampaignCodes, ...missingPermissionCodes(["leads_retrieval"]), ...formCodes]),
        media_upload: capabilityCheck([...missingPermissionCodes(["ads_management"]), ...taskCodes]),
        proposal_creation: capabilityCheck([...missingPermissionCodes(["ads_management"]), ...taskCodes]),
      },
      gaps: [...gaps.values()],
    };
  }

  async function listCampaigns(input: ScopedRequest & PageRequest & { status?: string }) {
    const scope = scopeOrConflict(db, input);
    const binding = { actor: input.actor, scope: `${scope.clientId}:${scope.adAccountId}`, filter: hash({ status: input.status ?? null, limit: input.limit }) };
    const after = input.cursor === undefined ? undefined : cursors.decode(input.cursor, binding);
    if (after !== undefined && typeof after !== "string") throw new ReportingError("Cursor binding does not match the request", 400, "cursor_mismatch");
    const response = await meta.request<{ data?: unknown; paging?: { cursors?: { after?: unknown } } }>({
      method: "GET",
      path: `/${scope.adAccountId}/campaigns`,
      query: { fields: "id,name,status,objective,daily_budget,lifetime_budget", limit: pageLimit(input.limit), status: input.status, after },
      scope,
      actor: input.actor,
      correlationId: input.requestId,
      operation: "list_campaigns",
    });
    const currency = scope.currency;
    const data = Array.isArray(response.data.data)
      ? response.data.data.flatMap((value) => {
          if (value === null || typeof value !== "object") return [];
          const row = value as Record<string, unknown>;
          const id = text(row, "id"); const name = text(row, "name"); const status = text(row, "status"); const objective = text(row, "objective");
          if (!id || name === undefined || !["ACTIVE", "PAUSED", "ARCHIVED", "DELETED"].includes(status ?? "") || !["OUTCOME_SALES", "OUTCOME_LEADS"].includes(objective ?? "")) return [];
          return [{
            campaign_id: id, name, status, objective,
            daily_budget: currency && row.daily_budget !== undefined ? minorMoney(row.daily_budget, currency) ?? null : null,
            lifetime_budget: currency && row.lifetime_budget !== undefined ? minorMoney(row.lifetime_budget, currency) ?? null : null,
          }];
        })
      : [];
    const upstream = response.data.paging?.cursors?.after;
    const nextCursor = typeof upstream === "string" && upstream.length > 0 ? cursors.encode({ ...binding, position: upstream }) : null;
    return { request_id: input.requestId, scope: resolved(scope), data, page: { next_cursor: nextCursor } };
  }

  async function queryInsights(input: ScopedRequest & PageRequest & { dateRange: { since: string; until: string }; level: Level }) {
    const scope = scopeOrConflict(db, input);
    if (input.dateRange.since > input.dateRange.until) throw new ReportingError("Unsupported query date range", 422, "unsupported_query");
    const raw = await meta.runAsyncInsights<Record<string, unknown>>({
      path: `/${scope.adAccountId}/insights`,
      query: {
        level: input.level,
        time_range: JSON.stringify(input.dateRange),
        fields: "account_id,account_name,campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,date_start,date_stop,spend,impressions,reach,clicks,ctr,cpc,cpm,results,conversions,cost_per_result,purchase_roas",
      },
      scope,
      actor: input.actor,
      correlationId: input.requestId,
      operation: "query_insights",
    });
    const rows = raw.flatMap((row) => {
      const value = scope.currency === undefined ? undefined : insightRow(row, input.level, scope.currency, input.dateRange);
      return value === undefined ? [] : [value];
    });
    const page = localPage(
      rows,
      input,
      { actor: input.actor, scope: `${scope.clientId}:${scope.adAccountId}`, filter: hash({ dateRange: input.dateRange, level: input.level, limit: input.limit }) },
      cursors,
    );
    return { request_id: input.requestId, scope: resolved(scope), level: input.level, date_range: input.dateRange, ...page };
  }

  return { listScopes, getIntegrationStatus, getCapabilities, listCampaigns, queryInsights };
}

export type ReportingService = ReturnType<typeof createReportingService>;

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function integerValue(value: unknown, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = typeof value === "number" ? value : Number(value);
  return parsed;
}

function requestId(context: Context): string {
  const value = stringValue(context.request.headers["x-request-id"]);
  return value ?? crypto.randomUUID();
}

function success(id: string, body: unknown): ContractResponse {
  return { statusCode: 200, mediaType: "application/json", headers: { "x-request-id": id }, body };
}

function errorResponse(context: Context, id: string, error: unknown): ContractResponse {
  let status = 500;
  let code = "internal_error";
  let title = "Internal Server Error";
  let detail = title;
  let supplied: ReportingError["supplied"];
  if (error instanceof ReportingError) {
    ({ status, code, supplied } = error);
    title = status === 422 ? "Unsupported query" : status === 409 ? "Scope conflict" : "Bad request";
    detail = error.message;
  } else if (error instanceof MetaError) {
    status = error.status === 429 ? 429 : 502;
    code = status === 429 ? "rate_limited" : "meta_error";
    title = status === 429 ? "Rate limited" : "Upstream error";
    detail = title;
  }
  if (context.operation?.operationId === "getCapabilities" && supplied === undefined) {
    const query = context.request.query as Record<string, unknown>;
    supplied = {
      ...(typeof query.client_id === "string" ? { client_id: query.client_id } : {}),
      ...(typeof query.ad_account_id === "string" ? { ad_account_id: query.ad_account_id } : {}),
    };
    if (Object.keys(supplied).length === 0) supplied = undefined;
  }
  return {
    statusCode: status,
    mediaType: "application/problem+json",
    headers: { "x-request-id": id, ...(status === 429 && error instanceof MetaError && error.retryAfterSeconds !== undefined ? { "retry-after": String(error.retryAfterSeconds) } : {}) },
    body: {
      type: `urn:fb-marketing-server:${code}`,
      title,
      status,
      code,
      detail,
      request_id: id,
      ...(supplied === undefined ? {} : { supplied_scope: supplied }),
    },
  };
}

export function createReportingHandlers(service: ReportingService, actor: string): HandlerMap {
  const handle = (work: (context: Context, id: string) => unknown | Promise<unknown>) => async (context: Context) => {
    const id = requestId(context);
    try {
      return success(id, await work(context, id));
    } catch (error) {
      return errorResponse(context, id, error);
    }
  };
  return {
    listScopes: handle((context, id) => {
      const query = context.request.query as Record<string, unknown>;
      return service.listScopes({ actor, requestId: id, limit: integerValue(query.limit, 50), ...(stringValue(query.cursor) ? { cursor: stringValue(query.cursor)! } : {}) });
    }),
    getIntegrationStatus: handle((context, id) => {
      const query = context.request.query as Record<string, unknown>;
      return service.getIntegrationStatus({
        actor,
        requestId: id,
        ...(stringValue(query.client_id) ? { clientId: stringValue(query.client_id)! } : {}),
        ...(stringValue(query.ad_account_id) ? { adAccountId: stringValue(query.ad_account_id)! } : {}),
      });
    }),
    getCapabilities: handle((context, id) => {
      const query = context.request.query as Record<string, unknown>;
      return service.getCapabilities({
        actor, requestId: id, clientId: String(query.client_id), adAccountId: String(query.ad_account_id),
        limit: integerValue(query.limit, 50),
        ...(stringValue(query.cursor) ? { cursor: stringValue(query.cursor)! } : {}),
        ...(stringValue(query.asset_type) ? { assetType: stringValue(query.asset_type)! as AssetType } : {}),
      });
    }),
    listCampaigns: handle((context, id) => {
      const query = context.request.query as Record<string, unknown>;
      return service.listCampaigns({
        actor, requestId: id, clientId: String(query.client_id), adAccountId: String(query.ad_account_id),
        limit: integerValue(query.limit, 50),
        ...(stringValue(query.cursor) ? { cursor: stringValue(query.cursor)! } : {}),
        ...(stringValue(query.status) ? { status: stringValue(query.status)! } : {}),
      });
    }),
    queryInsights: handle((context, id) => {
      const query = context.request.query as Record<string, unknown>;
      const body = context.request.body as { client_id: string; ad_account_id: string; date_range: { since: string; until: string }; level: Level };
      return service.queryInsights({
        actor, requestId: id, clientId: body.client_id, adAccountId: body.ad_account_id,
        dateRange: body.date_range, level: body.level, limit: integerValue(query.limit, 50),
        ...(stringValue(query.cursor) ? { cursor: stringValue(query.cursor)! } : {}),
      });
    }),
  };
}
