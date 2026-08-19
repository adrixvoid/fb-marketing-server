import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { Context, HandlerMap } from "openapi-backend";
import type { ContractResponse } from "./contract.js";
import type { components } from "./generated/openapi.js";
import { appendAudit, transaction } from "./db.js";
import { resolveScope, type ResolvedScope } from "./scope.js";

type CreateOperationRequest = components["schemas"]["CreateOperationRequest"];
type Operation = components["schemas"]["Operation"];
type CapabilityAsset = components["schemas"]["CapabilityAsset"];
type CapabilityName = "sales_website" | "leads_website" | "leads_instant_form";

const TWELVE_HOURS_MS = 12 * 60 * 60 * 1_000;
const operationTypes = new Set(["create_campaign_bundle", "update_object", "change_delivery", "configure_monthly_budget"]);

export class OperationError extends Error {
  constructor(
    message: string,
    readonly status: 404 | 409 | 422,
    readonly code: "not_found" | "client_account_mismatch" | "idempotency_conflict" | "unsupported_campaign_variant" | "unsupported_campaign_combination" | "asset_incompatible" | "operation_semantics_invalid",
  ) {
    super(message);
  }
}

interface CapabilitySnapshot {
  assets: CapabilityAsset[];
  capabilities: Record<CapabilityName, { status: string }>;
}

interface OperationsOptions {
  db: DatabaseSync;
  mediaRoot: string;
  capabilities(input: { actor: string; requestId: string; clientId: string; adAccountId: string }): Promise<CapabilitySnapshot>;
  validateTarget(input: { actor: string; requestId: string; scope: ResolvedScope; objectType: "campaign" | "ad_set" | "ad"; objectId: string }): Promise<boolean>;
  now?: () => Date;
}

interface ProposeInput {
  actor: string;
  requestId: string;
  idempotencyKey: string;
  request: CreateOperationRequest;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  }
  return value;
}

export function canonicalPayload(value: unknown): string {
  return JSON.stringify(canonical(value));
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function fileHash(path: string): Promise<string> {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest("hex");
}

function scopeResponse(scope: ResolvedScope) {
  return {
    client_id: scope.clientId,
    client_name: scope.clientName,
    ad_account_id: scope.adAccountId,
    ad_account_name: scope.adAccountName,
    ...(scope.currency === undefined ? {} : { currency: scope.currency }),
    ...(scope.timezone === undefined ? {} : { timezone: scope.timezone }),
  };
}

interface OperationRow {
  id: string;
  operation_type: string;
  status: Operation["status"];
  generation_id: string;
  payload_json: string;
  payload_hash: string;
  result_json: string | null;
  created_at: string;
  expires_at: string;
  client_id: string;
  ad_account_id: string;
  decision_value?: "approved" | "rejected" | null;
  decided_at?: string | null;
  owner_identity?: string | null;
}

function operationFromRow(row: OperationRow, scope: ResolvedScope): Operation {
  return {
    operation_id: row.id,
    type: row.operation_type,
    status: row.status,
    scope: scopeResponse(scope),
    integration_generation: row.generation_id,
    payload_hash: row.payload_hash,
    payload: JSON.parse(row.payload_json),
    created_at: row.created_at,
    expires_at: row.expires_at,
    decision: row.decision_value == null ? null : {
      decision: row.decision_value,
      decided_at: row.decided_at!,
      owner_identity: row.owner_identity!,
    },
    result: row.result_json === null ? null : JSON.parse(row.result_json),
  } as Operation;
}

function moneyCurrency(scope: ResolvedScope, money: { currency: string }): void {
  if (scope.currency === undefined || money.currency !== scope.currency) {
    throw new OperationError("Money currency does not match the Ad Account", 422, "operation_semantics_invalid");
  }
}

function assetId(asset: CapabilityAsset): string {
  if ("page_id" in asset && asset.asset_type === "page") return asset.page_id;
  if ("pixel_id" in asset) return asset.pixel_id;
  if ("lead_gen_form_id" in asset) return asset.lead_gen_form_id;
  return asset.instagram_account_id;
}

export function createOperationsService({ db, mediaRoot, capabilities, validateTarget, now = () => new Date() }: OperationsOptions) {
  function resolve(input: { clientId: string; adAccountId: string }): ResolvedScope {
    try {
      return resolveScope(db, input, { task: "ADVERTISE", permission: "ads_management" });
    } catch {
      throw new OperationError("Scope is not authorized", 409, "client_account_mismatch");
    }
  }

  function idempotent(input: ProposeInput, payloadHash: string): OperationRow | undefined {
    const row = db.prepare(`
      SELECT o.*, d.decision AS decision_value, d.decided_at, d.owner_identity FROM operation_idempotency i
      JOIN operations o ON o.id = i.operation_id
      LEFT JOIN approval_decisions d ON d.operation_id = o.id
      WHERE i.actor = ? AND i.operation_type = ? AND i.client_id = ? AND i.ad_account_id = ? AND i.idempotency_key = ?
    `).get(input.actor, input.request.type, input.request.client_id, input.request.ad_account_id, input.idempotencyKey) as unknown as OperationRow | undefined;
    if (row !== undefined && row.payload_hash !== payloadHash) {
      throw new OperationError("Idempotency key is bound to a different payload", 409, "idempotency_conflict");
    }
    return row;
  }

  async function campaignSemantics(input: ProposeInput, scope: ResolvedScope) {
    if (input.request.type !== "create_campaign_bundle") return { derived: {}, media: [] as Array<{ media_id: string; sha256: string }> };
    const proposal = input.request.payload;
    const name = ({ SALES_WEBSITE: "sales_website", LEADS_WEBSITE: "leads_website", LEADS_INSTANT_FORM: "leads_instant_form" } as const)[proposal.campaign_kind];
    if (name === undefined) throw new OperationError("Campaign kind is unsupported", 422, "unsupported_campaign_variant");
    const snapshot = await capabilities({ actor: input.actor, requestId: input.requestId, clientId: scope.clientId, adAccountId: scope.adAccountId });
    if (snapshot.capabilities[name]?.status !== "available") throw new OperationError("Campaign capability is unavailable", 422, "asset_incompatible");
    const assets = new Map(snapshot.assets.map((asset) => [`${asset.asset_type}:${assetId(asset)}`, asset]));
    const creative = proposal.creative;
    const page = assets.get(`page:${creative.page_id}`);
    if (page === undefined) throw new OperationError("Page is unavailable", 422, "asset_incompatible");
    if (creative.instagram_account_id !== undefined) {
      const instagram = assets.get(`instagram_account:${creative.instagram_account_id}`);
      if (instagram === undefined || ("page_id" in instagram && instagram.page_id !== undefined && instagram.page_id !== creative.page_id)) {
        throw new OperationError("Instagram Account is incompatible", 422, "asset_incompatible");
      }
    }
    moneyCurrency(scope, proposal.campaign.budget.value);
    if (proposal.ad_set.targeting.minimum_age > proposal.ad_set.targeting.maximum_age) {
      throw new OperationError("Targeting age range is invalid", 422, "operation_semantics_invalid");
    }
    if (proposal.ad_set.start_time && proposal.ad_set.end_time && proposal.ad_set.start_time >= proposal.ad_set.end_time) {
      throw new OperationError("Campaign schedule is invalid", 422, "operation_semantics_invalid");
    }
    const website = proposal.campaign_kind !== "LEADS_INSTANT_FORM";
    if (website) {
      if (!proposal.ad_set.pixel_id || !creative.website_url?.startsWith("https://") || !assets.has(`pixel:${proposal.ad_set.pixel_id}`) || proposal.ad_set.lead_gen_form_id !== undefined) {
        throw new OperationError("Website campaign assets are incompatible", 422, "unsupported_campaign_combination");
      }
    } else {
      const form = proposal.ad_set.lead_gen_form_id === undefined ? undefined : assets.get(`lead_form:${proposal.ad_set.lead_gen_form_id}`);
      if (proposal.ad_set.pixel_id !== undefined || creative.website_url !== undefined || form === undefined || !("page_id" in form) || form.page_id !== creative.page_id) {
        throw new OperationError("Instant form does not match its Page", 422, "unsupported_campaign_combination");
      }
    }
    const salesCtas = new Set(["SHOP_NOW", "BUY_NOW", "ORDER_NOW", "ADD_TO_CART", "LEARN_MORE", "GET_OFFER", "SUBSCRIBE"]);
    const leadsCtas = new Set(["LEARN_MORE", "SUBSCRIBE", "SIGN_UP", "APPLY_NOW", "GET_QUOTE", "CONTACT_US", "BOOK_NOW", "GET_STARTED"]);
    if (!(proposal.campaign_kind === "SALES_WEBSITE" ? salesCtas : leadsCtas).has(creative.call_to_action)) {
      throw new OperationError("Call to action is incompatible", 422, "unsupported_campaign_combination");
    }
    return {
      derived: proposal.campaign_kind === "SALES_WEBSITE"
        ? { objective: "OUTCOME_SALES", destination: "WEBSITE", optimization_goal: "OFFSITE_CONVERSIONS", billing_event: "IMPRESSIONS", conversion_event: "PURCHASE" }
        : proposal.campaign_kind === "LEADS_WEBSITE"
          ? { objective: "OUTCOME_LEADS", destination: "WEBSITE", optimization_goal: "OFFSITE_CONVERSIONS", billing_event: "IMPRESSIONS", conversion_event: "LEAD" }
          : { objective: "OUTCOME_LEADS", destination: "ON_AD", optimization_goal: "LEAD_GENERATION", billing_event: "IMPRESSIONS", conversion_event: "LEAD" },
      media: creative.media,
    };
  }

  async function otherSemantics(input: ProposeInput, scope: ResolvedScope): Promise<void> {
    if (input.request.type === "update_object") {
      const payload = input.request.payload;
      if (!(new Set(["campaign", "ad_set", "ad"])).has(payload.object_type)) throw new OperationError("Object type is unsupported", 422, "operation_semantics_invalid");
      if (payload.object_type === "campaign" && "budget" in payload.changes && payload.changes.budget) moneyCurrency(scope, payload.changes.budget.value);
      if (payload.object_type === "ad_set" && payload.changes.start_time && payload.changes.end_time && payload.changes.start_time >= payload.changes.end_time) {
        throw new OperationError("Ad Set schedule is invalid", 422, "operation_semantics_invalid");
      }
      if (!await validateTarget({ actor: input.actor, requestId: input.requestId, scope, objectType: payload.object_type, objectId: payload.object_id })) {
        throw new OperationError("Target is unavailable", 422, "asset_incompatible");
      }
    } else if (input.request.type === "change_delivery") {
      const type = ({ Campaign: "campaign", AdSet: "ad_set", Ad: "ad" } as const)[input.request.payload.object_type];
      if (type === undefined) throw new OperationError("Creative delivery transitions are forbidden", 422, "operation_semantics_invalid");
      if (!await validateTarget({ actor: input.actor, requestId: input.requestId, scope, objectType: type, objectId: input.request.payload.object_id })) {
        throw new OperationError("Target is unavailable", 422, "asset_incompatible");
      }
    } else if (input.request.type === "configure_monthly_budget") {
      moneyCurrency(scope, input.request.payload.monthly_budget);
    }
  }

  async function validateMedia(scope: ResolvedScope, bindings: Array<{ media_id: string; sha256: string }>, at: Date, status = "staged") {
    const seen = new Set<string>();
    const rows: Array<{ media_id: string; sha256: string }> = [];
    for (const binding of bindings) {
      if (seen.has(binding.media_id)) throw new OperationError("Media is duplicated", 422, "operation_semantics_invalid");
      seen.add(binding.media_id);
      const row = db.prepare(`
        SELECT id, sha256, storage_name FROM staged_media
        WHERE id = ? AND client_id = ? AND ad_account_id = ? AND generation_id = ?
          AND status = ? AND expires_at > ?
      `).get(binding.media_id, scope.clientId, scope.adAccountId, scope.generationId, status, at.toISOString()) as { id: string; sha256: string; storage_name: string } | undefined;
      if (row === undefined || row.sha256 !== binding.sha256) throw new OperationError("Bound media is invalid", 422, "asset_incompatible");
      try {
        if (await fileHash(join(mediaRoot, row.storage_name)) !== binding.sha256) throw new Error();
      } catch {
        throw new OperationError("Bound media hash is invalid", 422, "asset_incompatible");
      }
      rows.push({ media_id: row.id, sha256: row.sha256 });
    }
    return rows;
  }

  async function proposeInternal(input: ProposeInput): Promise<{ created: boolean; operation: Operation }> {
    if (!operationTypes.has(input.request.type) || input.idempotencyKey.length < 16 || input.idempotencyKey.length > 128) {
      throw new OperationError("Operation request is invalid", 422, "operation_semantics_invalid");
    }
    const scope = resolve({ clientId: input.request.client_id, adAccountId: input.request.ad_account_id });
    const payloadJson = canonicalPayload(input.request.payload);
    const payloadHash = sha256(payloadJson);
    const existing = idempotent(input, payloadHash);
    if (existing !== undefined) return { created: false, operation: operationFromRow(existing, scope) };
    const at = now();
    const { derived, media } = await campaignSemantics(input, scope);
    await otherSemantics(input, scope);
    const mediaRows = await validateMedia(scope, media, at);
    const operationId = randomUUID();
    const expiresAt = new Date(at.getTime() + TWELVE_HOURS_MS);
    let created = true;
    const row = transaction(db, () => {
      const raced = idempotent(input, payloadHash);
      if (raced !== undefined) {
        created = false;
        return raced;
      }
      db.prepare(`
        INSERT INTO operations
          (id, actor, client_id, ad_account_id, generation_id, operation_type, payload_json,
           payload_hash, derived_json, status, created_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
      `).run(operationId, input.actor, scope.clientId, scope.adAccountId, scope.generationId, input.request.type, payloadJson, payloadHash, canonicalPayload(derived), at.toISOString(), expiresAt.toISOString());
      db.prepare(`
        INSERT INTO operation_idempotency
          (actor, operation_type, client_id, ad_account_id, idempotency_key, payload_hash, operation_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(input.actor, input.request.type, scope.clientId, scope.adAccountId, input.idempotencyKey, payloadHash, operationId, at.toISOString());
      for (const binding of mediaRows) {
        db.prepare("INSERT INTO operation_media (operation_id, media_id, media_hash, client_id, ad_account_id) VALUES (?, ?, ?, ?, ?)")
          .run(operationId, binding.media_id, binding.sha256, scope.clientId, scope.adAccountId);
        db.prepare("UPDATE staged_media SET status = 'bound' WHERE id = ? AND status = 'staged'").run(binding.media_id);
      }
      const auditId = appendAudit(db, {
        actor: input.actor, clientId: scope.clientId, adAccountId: scope.adAccountId, generationId: scope.generationId,
        operation: "propose_operation", correlationId: input.requestId, occurredAt: at.toISOString(), outcome: "succeeded",
        evidence: { externalRequestId: operationId },
      });
      db.prepare("INSERT INTO operation_audit_links (audit_id, operation_id, event_type) VALUES (?, ?, 'proposal')").run(auditId, operationId);
      return db.prepare("SELECT * FROM operations WHERE id = ?").get(operationId) as unknown as OperationRow;
    });
    return { created, operation: operationFromRow(row, scope) };
  }

  async function propose(input: ProposeInput): Promise<{ created: boolean; operation: Operation }> {
    try {
      const result = await proposeInternal(input);
      if (!result.created) {
        const scope = resolve({ clientId: input.request.client_id, adAccountId: input.request.ad_account_id });
        appendAudit(db, {
          actor: input.actor, clientId: scope.clientId, adAccountId: scope.adAccountId, generationId: scope.generationId,
          operation: "reuse_operation", correlationId: input.requestId, occurredAt: now().toISOString(), outcome: "succeeded",
          evidence: { externalRequestId: result.operation.operation_id },
        });
      }
      return result;
    } catch (error) {
      let scope: ResolvedScope | undefined;
      try {
        scope = resolveScope(db, { clientId: input.request.client_id, adAccountId: input.request.ad_account_id });
      } catch {
        scope = undefined;
      }
      const existingBinding = db.prepare(`SELECT operation_id FROM operation_idempotency
        WHERE actor = ? AND operation_type = ? AND client_id = ? AND ad_account_id = ? AND idempotency_key = ?`)
        .get(input.actor, input.request.type, input.request.client_id, input.request.ad_account_id, input.idempotencyKey) as { operation_id: string } | undefined;
      transaction(db, () => {
        const auditId = appendAudit(db, {
          actor: input.actor,
          ...(scope === undefined ? {} : { clientId: scope.clientId, adAccountId: scope.adAccountId, generationId: scope.generationId }),
          operation: "propose_operation", correlationId: input.requestId, occurredAt: now().toISOString(), outcome: "failed",
          evidence: { errorCode: error instanceof OperationError ? error.code : "operation_semantics_invalid" },
        });
        if (existingBinding !== undefined) {
          db.prepare("INSERT INTO operation_audit_links (audit_id, operation_id, event_type) VALUES (?, ?, 'proposal')")
            .run(auditId, existingBinding.operation_id);
        }
      });
      throw error;
    }
  }

  function get(input: { actor: string; requestId: string; clientId: string; adAccountId: string; operationId: string }): Operation {
    const scope = resolve({ clientId: input.clientId, adAccountId: input.adAccountId });
    const row = db.prepare(`SELECT o.*, d.decision AS decision_value, d.decided_at, d.owner_identity
      FROM operations o LEFT JOIN approval_decisions d ON d.operation_id = o.id
      WHERE o.id = ? AND o.client_id = ? AND o.ad_account_id = ?`)
      .get(input.operationId, scope.clientId, scope.adAccountId) as unknown as OperationRow | undefined;
    if (row === undefined) throw new OperationError("Operation was not found", 404, "not_found");
    return operationFromRow(row, scope);
  }

  async function revalidate(input: { actor: string; requestId: string; operationId: string }): Promise<Operation> {
    const row = db.prepare(`SELECT o.*, d.decision AS decision_value, d.decided_at, d.owner_identity
      FROM operations o LEFT JOIN approval_decisions d ON d.operation_id = o.id WHERE o.id = ?`)
      .get(input.operationId) as unknown as OperationRow | undefined;
    if (row === undefined) throw new OperationError("Operation was not found", 404, "not_found");
    const scope = resolve({ clientId: row.client_id, adAccountId: row.ad_account_id });
    if (scope.generationId !== row.generation_id || sha256(canonicalPayload(JSON.parse(row.payload_json))) !== row.payload_hash) {
      throw new OperationError("Operation identity is stale", 409, "client_account_mismatch");
    }
    const request = {
      type: row.operation_type,
      client_id: row.client_id,
      ad_account_id: row.ad_account_id,
      payload: JSON.parse(row.payload_json),
    } as CreateOperationRequest;
    const proposalInput: ProposeInput = { actor: input.actor, requestId: input.requestId, idempotencyKey: "revalidation-only", request };
    const { media } = await campaignSemantics(proposalInput, scope);
    await otherSemantics(proposalInput, scope);
    const mediaRows = await validateMedia(scope, media, now(), "bound");
    const links = db.prepare("SELECT media_id, media_hash FROM operation_media WHERE operation_id = ? ORDER BY media_id").all(row.id);
    const expected = mediaRows.map(({ media_id, sha256: media_hash }) => ({ media_id, media_hash })).sort((a, b) => a.media_id.localeCompare(b.media_id));
    if (canonicalPayload(links) !== canonicalPayload(expected)) throw new OperationError("Operation media binding is stale", 409, "client_account_mismatch");
    return operationFromRow(row, scope);
  }

  return { propose, get, revalidate };
}

type OperationsService = ReturnType<typeof createOperationsService>;

function requestId(context: Context): string {
  const value = context.request.headers["x-request-id"];
  return typeof value === "string" && /^[A-Za-z0-9._:-]{8,128}$/.test(value) ? value : randomUUID();
}

function supplied(request: unknown): { client_id: string; ad_account_id: string } | undefined {
  if (request === null || typeof request !== "object") return undefined;
  const value = request as Record<string, unknown>;
  return typeof value.client_id === "string" && typeof value.ad_account_id === "string"
    ? { client_id: value.client_id, ad_account_id: value.ad_account_id }
    : undefined;
}

function operationProblem(context: Context, error: OperationError, scope?: { client_id: string; ad_account_id: string }): ContractResponse {
  const id = requestId(context);
  return {
    statusCode: error.status,
    mediaType: "application/problem+json",
    headers: { "x-request-id": id },
    body: {
      type: `urn:fb-marketing-server:${error.code}`,
      title: error.status === 404 ? "Not found" : error.status === 409 ? "Conflict" : "Unprocessable operation",
      status: error.status,
      code: error.code,
      detail: error.message,
      request_id: id,
      ...(scope === undefined ? {} : { supplied_scope: scope }),
    },
  };
}

export function createOperationHandlers(service: OperationsService, actor: string): HandlerMap {
  return {
    createOperation: async (context: Context) => {
      const id = requestId(context);
      const request = context.request.body as CreateOperationRequest;
      try {
        const result = await service.propose({
          actor,
          requestId: id,
          idempotencyKey: String(context.request.headers["idempotency-key"] ?? ""),
          request,
        });
        return {
          statusCode: result.created ? 201 : 200,
          mediaType: "application/json",
          headers: { "x-request-id": id },
          body: { request_id: id, operation: result.operation },
        } satisfies ContractResponse;
      } catch (error) {
        if (error instanceof OperationError) return operationProblem(context, error, supplied(request));
        throw error;
      }
    },
    getOperation: (context: Context) => {
      const id = requestId(context);
      try {
        const operation = service.get({
          actor,
          requestId: id,
          clientId: String(context.request.query.client_id ?? ""),
          adAccountId: String(context.request.query.ad_account_id ?? ""),
          operationId: String(context.request.params.operation_id ?? ""),
        });
        return {
          statusCode: 200,
          mediaType: "application/json",
          headers: { "x-request-id": id },
          body: { request_id: id, operation },
        } satisfies ContractResponse;
      } catch (error) {
        if (error instanceof OperationError) return operationProblem(context, error);
        throw error;
      }
    },
  };
}
