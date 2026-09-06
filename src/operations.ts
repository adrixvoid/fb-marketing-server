import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { Context, HandlerMap } from "openapi-backend";
import type { ContractResponse } from "./contract.js";
import type { components } from "./generated/openapi.js";
import { appendAudit, transaction } from "./db.js";
import { MetaError, type MetaRequest } from "./meta-client.js";
import { resolveScope, type ResolvedScope } from "./scope.js";
import { requestId } from "./request-id.js";

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
    readonly code: "not_found" | "client_account_mismatch" | "idempotency_conflict" | "unsupported_campaign_variant" | "unsupported_campaign_combination" | "asset_incompatible" | "operation_semantics_invalid" | "operation_stale",
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
  hashMediaFile(storageName: string): Promise<string>;
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

export function canonicalPayload(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Value is not canonical JSON");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalPayload).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalPayload(item)}`).join(",")}}`;
  }
  throw new Error("Value is not canonical JSON");
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function invalidSchedule(start: string | undefined, end: string | undefined): boolean {
  if (start === undefined && end === undefined) return false;
  const startTime = start === undefined ? undefined : Date.parse(start);
  const endTime = end === undefined ? undefined : Date.parse(end);
  return startTime !== undefined && Number.isNaN(startTime) || endTime !== undefined && Number.isNaN(endTime) ||
    startTime !== undefined && endTime !== undefined && startTime >= endTime;
}

function scopeResponse(scope: Pick<ResolvedScope, "clientId" | "clientName" | "adAccountId" | "adAccountName" | "currency" | "timezone">) {
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

export function operationReview(operationType: string, value: unknown): object {
  const payload = value as Record<string, any>;
  if (operationType === "create_campaign_bundle") {
    const campaign = payload.campaign as Record<string, any>;
    const adSet = payload.ad_set as Record<string, any>;
    const creative = payload.creative as Record<string, any>;
    return {
      campaign_kind: payload.campaign_kind,
      campaign: { name: campaign.name, budget: campaign.budget },
      ad_set: {
        name: adSet.name,
        ...(adSet.pixel_id === undefined ? {} : { pixel_id: adSet.pixel_id }),
        ...(adSet.lead_gen_form_id === undefined ? {} : { lead_gen_form_id: adSet.lead_gen_form_id }),
        ...(adSet.start_time === undefined ? {} : { start_time: adSet.start_time }),
        ...(adSet.end_time === undefined ? {} : { end_time: adSet.end_time }),
        targeting: adSet.targeting,
      },
      creative: {
        name: creative.name,
        page_id: creative.page_id,
        ...(creative.instagram_account_id === undefined ? {} : { instagram_account_id: creative.instagram_account_id }),
        message: creative.message,
        ...(creative.headline === undefined ? {} : { headline: creative.headline }),
        ...(creative.website_url === undefined ? {} : { website_url: creative.website_url }),
        call_to_action: creative.call_to_action,
        media: (creative.media as unknown[]).map((binding) => {
          const media = binding as Record<string, unknown>;
          return { media_id: media.media_id, sha256: media.sha256 };
        }),
      },
      ad: { name: (payload.ad as Record<string, unknown>).name },
    };
  }
  if (operationType === "update_object") {
    const changes = payload.changes as Record<string, unknown>;
    return {
      object_type: payload.object_type,
      object_id: payload.object_id,
      changes: {
        ...(changes.name === undefined ? {} : { name: changes.name }),
        ...(changes.start_time === undefined ? {} : { start_time: changes.start_time }),
        ...(changes.end_time === undefined ? {} : { end_time: changes.end_time }),
        ...(changes.targeting === undefined ? {} : { targeting: changes.targeting }),
        ...(changes.budget === undefined ? {} : { budget: changes.budget }),
      },
    };
  }
  if (operationType === "change_delivery") return { action: payload.action, object_type: payload.object_type, object_id: payload.object_id };
  return { monthly_budget: payload.monthly_budget };
}

export function operationNextAction(status: Operation["status"]): components["schemas"]["NextAction"] {
  if (status === "pending") return "approve_or_reject";
  if (status === "executing") return "wait";
  if (status === "succeeded" || status === "rejected") return "no_action";
  if (status === "failed") return "fix_input";
  return "retry_new_operation";
}

function operationFromRow(row: OperationRow, scope: Pick<ResolvedScope, "clientId" | "clientName" | "adAccountId" | "adAccountName" | "currency" | "timezone">): Operation {
  return {
    operation_id: row.id,
    type: row.operation_type,
    status: row.status,
    scope: scopeResponse(scope),
    integration_generation: row.generation_id,
    payload_hash: row.payload_hash,
    review: operationReview(row.operation_type, JSON.parse(row.payload_json)),
    next_action: operationNextAction(row.status),
    created_at: row.created_at,
    expires_at: row.expires_at,
    decision: row.decision_value == null ? null : {
      decision: row.decision_value,
      decided_at: row.decided_at!,
      owner_identity: row.owner_identity!,
    },
    result: row.result_json === null ? null : JSON.parse(row.result_json),
  } as unknown as Operation;
}

export function operationExecutionView(db: DatabaseSync, operation: Operation): Operation {
  if (operation.status !== "executing" && operation.status !== "stale") return operation;
  const execution = db.prepare("SELECT status FROM operation_executions WHERE operation_id = ?").get(operation.operation_id) as { status: ExecutionRow["status"] } | undefined;
  if (execution === undefined) return operation;
  const provenResources = db.prepare(`SELECT CASE kind WHEN 'update_object' THEN 'object' WHEN 'change_delivery' THEN 'object'
      WHEN 'configure_monthly_budget' THEN 'budget' ELSE kind END AS type, external_id AS id FROM operation_steps
    WHERE operation_id = ? AND status = 'succeeded' ORDER BY sequence`).all(operation.operation_id)
    .map(({ type, id }) => ({ type: String(type), id: String(id) }));
  const unresolved = db.prepare(`SELECT step_key FROM operation_steps WHERE operation_id = ?
    AND status IN ('intent', 'failed', 'reconciliation_required') ORDER BY sequence LIMIT 1`).get(operation.operation_id) as { step_key: string } | undefined;
  if (operation.status === "stale") {
    return {
      ...operation,
      result: { status: "stale", proven_resources: provenResources, failed_or_ambiguous_step: unresolved?.step_key ?? null, next_action: "retry_new_operation" },
    } as unknown as Operation;
  }
  const reconciliationRequired = execution.status === "reconciliation_required" || unresolved?.step_key !== undefined;
  const nextAction = reconciliationRequired ? "reconcile_manually_no_automatic_replay" : "wait";
  if (reconciliationRequired && unresolved === undefined) throw new Error("Reconciliation state lacks persisted step evidence");
  return {
    ...operation,
    execution_state: reconciliationRequired ? "reconciliation_required" : "active",
    next_action: nextAction,
    result: {
      status: reconciliationRequired ? "reconciliation_required" : "executing",
      proven_resources: provenResources,
      failed_or_ambiguous_step: reconciliationRequired ? unresolved!.step_key : null,
      next_action: nextAction,
    },
  } as unknown as Operation;
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

export function createOperationsService({ db, hashMediaFile, capabilities, validateTarget, now = () => new Date() }: OperationsOptions) {
  function resolve(input: { clientId: string; adAccountId: string }): ResolvedScope {
    try {
      return resolveScope(db, input, { task: "ADVERTISE", permission: "ads_management" });
    } catch {
      throw new OperationError("Scope is not authorized", 409, "client_account_mismatch");
    }
  }

  function resolveOwned(input: { clientId: string; adAccountId: string }): Pick<ResolvedScope, "clientId" | "clientName" | "adAccountId" | "adAccountName" | "currency" | "timezone"> {
    const row = db.prepare(`SELECT c.name AS client_name, a.name AS account_name, a.currency, a.timezone
      FROM clients c JOIN ad_accounts a ON a.client_id = c.id WHERE c.id = ? AND a.id = ? AND c.active = 1`)
      .get(input.clientId, input.adAccountId) as { client_name: string; account_name: string; currency: string | null; timezone: string | null } | undefined;
    if (row === undefined) throw new OperationError("Scope is not owned", 409, "client_account_mismatch");
    return {
      clientId: input.clientId, clientName: row.client_name, adAccountId: input.adAccountId, adAccountName: row.account_name,
      ...(row.currency === null ? {} : { currency: row.currency }), ...(row.timezone === null ? {} : { timezone: row.timezone }),
    };
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
    if (creative.media.length !== 1) throw new OperationError("Exactly one creative media item is required", 422, "operation_semantics_invalid");
    const page = assets.get(`page:${creative.page_id}`);
    if (page === undefined) throw new OperationError("Page is unavailable", 422, "asset_incompatible");
    if (creative.instagram_account_id !== undefined) {
      const instagram = assets.get(`instagram_account:${creative.instagram_account_id}`);
      if (instagram === undefined || ("page_id" in instagram && instagram.page_id !== undefined && instagram.page_id !== creative.page_id)) {
        throw new OperationError("Instagram Account is incompatible", 422, "asset_incompatible");
      }
    }
    moneyCurrency(scope, proposal.campaign.budget.value);
    if (proposal.campaign.budget.kind === "lifetime" && proposal.ad_set.end_time === undefined) {
      throw new OperationError("Lifetime budget requires an Ad Set end time", 422, "operation_semantics_invalid");
    }
    if (proposal.ad_set.targeting.minimum_age > proposal.ad_set.targeting.maximum_age) {
      throw new OperationError("Targeting age range is invalid", 422, "operation_semantics_invalid");
    }
    if (invalidSchedule(proposal.ad_set.start_time, proposal.ad_set.end_time)) {
      throw new OperationError("Campaign schedule is invalid", 422, "operation_semantics_invalid");
    }
    const website = proposal.campaign_kind !== "LEADS_INSTANT_FORM";
    if (website) {
      if (!proposal.ad_set.pixel_id || !creative.website_url?.startsWith("https://") || !assets.has(`pixel:${proposal.ad_set.pixel_id}`) || proposal.ad_set.lead_gen_form_id !== undefined) {
        throw new OperationError("Website campaign assets are incompatible", 422, "unsupported_campaign_combination");
      }
    } else {
      const form = proposal.ad_set.lead_gen_form_id === undefined ? undefined : assets.get(`lead_form:${proposal.ad_set.lead_gen_form_id}`);
      if (
        proposal.ad_set.pixel_id !== undefined || creative.website_url !== undefined || form === undefined ||
        !("page_id" in form) || form.page_id !== creative.page_id || !("published" in form) || form.published !== true || !("usable" in form) || form.usable !== true
      ) {
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
      if (payload.object_type === "ad_set" && invalidSchedule(payload.changes.start_time, payload.changes.end_time)) {
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
        if (await hashMediaFile(row.storage_name) !== binding.sha256) throw new Error();
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
    if (existing !== undefined) return { created: false, operation: operationExecutionView(db, operationFromRow(existing, scope)) };
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
    return { created, operation: operationExecutionView(db, operationFromRow(row, scope)) };
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
    const scope = resolveOwned({ clientId: input.clientId, adAccountId: input.adAccountId });
    const row = db.prepare(`SELECT o.*, d.decision AS decision_value, d.decided_at, d.owner_identity
      FROM operations o LEFT JOIN approval_decisions d ON d.operation_id = o.id
      WHERE o.id = ? AND o.client_id = ? AND o.ad_account_id = ?`)
      .get(input.operationId, scope.clientId, scope.adAccountId) as unknown as OperationRow | undefined;
    if (row === undefined) throw new OperationError("Operation was not found", 404, "not_found");
    return operationExecutionView(db, operationFromRow(row, scope));
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
    const authoritative = resolve({ clientId: row.client_id, adAccountId: row.ad_account_id });
    if (authoritative.generationId !== row.generation_id) throw new OperationError("Operation identity is stale", 409, "client_account_mismatch");
    return operationExecutionView(db, operationFromRow(row, authoritative));
  }

  return { propose, get, revalidate };
}

interface ExecutionOperationRow extends OperationRow {
  actor: string;
  derived_json: string;
  decision_id: string;
  decision_value: "approved";
}

interface ExecutionOptions {
  db: DatabaseSync;
  meta: { request(input: MetaRequest): Promise<{ data: unknown; rate: unknown }> };
  revalidate(input: { actor: string; requestId: string; operationId: string }): Promise<unknown>;
  readMedia(input: { operationId: string; mediaId: string; sha256: string }): Promise<{
    contentType: "image/jpeg" | "image/png" | "video/mp4";
    bytes: Uint8Array;
  }>;
  cleanupOperationMedia(operationId: string, status: "consumed" | "expired" | "invalid"): Promise<number>;
  now?: () => Date;
  testHooks?: {
    beforeStepIntent?: (stepKey: string) => void;
    afterStepIntent?: (stepKey: string) => void;
    afterMetaResponse?: (stepKey: string) => void;
    afterStepSuccess?: (stepKey: string) => void;
    afterLocalStepSuccess?: () => void;
  };
}

interface ExecuteInput {
  operationId: string;
  actor: string;
  requestId: string;
}

interface ExecutionRow {
  id: string;
  operation_id: string;
  decision_id: string;
  status: "running" | "reconciliation_required" | "succeeded" | "failed";
  correlation_id: string;
}

function executionOperation(db: DatabaseSync, operationId: string): ExecutionOperationRow {
  const row = db.prepare(`SELECT o.*, d.id AS decision_id, d.decision AS decision_value,
      d.decided_at, d.owner_identity
    FROM operations o JOIN approval_decisions d ON d.operation_id = o.id
    WHERE o.id = ? AND d.decision = 'approved'`).get(operationId) as unknown as ExecutionOperationRow | undefined;
  if (row === undefined) throw new OperationError("Operation is not approved", 409, "operation_semantics_invalid");
  return row;
}

function externalId(value: unknown, field = "id"): string | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const id = (value as Record<string, unknown>)[field];
  return typeof id === "string" && id.length > 0 && id.length <= 255 ? id : undefined;
}

function amountMinor(value: { amount: string; currency: string }): string {
  const scale = new Intl.NumberFormat("en", { style: "currency", currency: value.currency }).resolvedOptions().maximumFractionDigits ?? 2;
  const [integer, fraction = ""] = value.amount.split(".");
  const padded = fraction.padEnd(scale + 1, "0");
  let minor = BigInt(`${integer}${padded.slice(0, scale)}`);
  const discarded = padded.slice(scale);
  if (discarded[0]! > "5" || discarded[0] === "5" && (/[1-9]/.test(discarded.slice(1)) || minor % 2n === 1n)) minor += 1n;
  return minor.toString();
}

function targeting(value: { countries: string[]; minimum_age: number; maximum_age: number }) {
  return { geo_locations: { countries: value.countries }, age_min: value.minimum_age, age_max: value.maximum_age };
}

function operationView(db: DatabaseSync, row: ExecutionOperationRow): Operation {
  const labels = db.prepare(`SELECT c.name AS client_name, a.name AS account_name, a.currency, a.timezone
    FROM clients c JOIN ad_accounts a ON a.client_id = c.id WHERE c.id = ? AND a.id = ?`)
    .get(row.client_id, row.ad_account_id) as { client_name: string; account_name: string; currency: string | null; timezone: string | null };
  const scope = {
    clientId: row.client_id, clientName: labels.client_name,
    adAccountId: row.ad_account_id, adAccountName: labels.account_name,
    generationId: row.generation_id,
    ...(labels.currency === null ? {} : { currency: labels.currency }),
    ...(labels.timezone === null ? {} : { timezone: labels.timezone }),
  };
  const current = db.prepare(`SELECT o.*, d.decision AS decision_value, d.decided_at, d.owner_identity
    FROM operations o LEFT JOIN approval_decisions d ON d.operation_id = o.id WHERE o.id = ?`)
    .get(row.id) as unknown as OperationRow;
  return operationExecutionView(db, operationFromRow(current, scope));
}

export function createExecutionService({ db, meta, revalidate, readMedia, cleanupOperationMedia, now = () => new Date(), testHooks = {} }: ExecutionOptions) {
  function provenResources(operationId: string): Array<{ type: string; id: string }> {
    return db.prepare(`SELECT CASE kind WHEN 'update_object' THEN 'object' WHEN 'change_delivery' THEN 'object'
        WHEN 'configure_monthly_budget' THEN 'budget' ELSE kind END AS type, external_id AS id FROM operation_steps
      WHERE operation_id = ? AND status = 'succeeded' ORDER BY sequence`).all(operationId)
      .map(({ type, id }) => ({ type: String(type), id: String(id) }));
  }

  function failedResult(row: ExecutionOperationRow, stepKey: string, failureCode: string) {
    return {
      status: "failed", completed_at: now().toISOString(), failure_code: failureCode,
      proven_resources: provenResources(row.id), failed_or_ambiguous_step: stepKey, next_action: "fix_input",
    };
  }

  function assertIdentity(row: ExecutionOperationRow): ResolvedScope {
    const scope = resolveScope(db, { clientId: row.client_id, adAccountId: row.ad_account_id }, { task: "ADVERTISE", permission: "ads_management" });
    if (
      scope.generationId !== row.generation_id ||
      sha256(canonicalPayload(JSON.parse(row.payload_json))) !== row.payload_hash
    ) throw new OperationError("Operation identity is stale", 409, "client_account_mismatch");
    return scope;
  }

  function claim(row: ExecutionOperationRow, input: ExecuteInput): ExecutionRow | "expired" | undefined {
    return transaction(db, () => {
      const current = executionOperation(db, row.id);
      const existing = db.prepare("SELECT * FROM operation_executions WHERE operation_id = ?").get(row.id) as unknown as ExecutionRow | undefined;
      if (existing !== undefined || current.status !== "pending") return undefined;
      assertIdentity(current);
      if (now().getTime() >= Date.parse(current.expires_at)) {
        db.prepare("UPDATE operations SET status = 'expired' WHERE id = ? AND status = 'pending'").run(current.id);
        return "expired";
      }
      const execution: ExecutionRow = {
        id: randomUUID(), operation_id: current.id, decision_id: current.decision_id, status: "running", correlation_id: input.requestId,
      };
      db.prepare(`INSERT INTO operation_executions
        (id, operation_id, decision_id, payload_hash, status, claimed_at, correlation_id)
        VALUES (?, ?, ?, ?, 'running', ?, ?)`)
        .run(execution.id, current.id, current.decision_id, current.payload_hash, now().toISOString(), input.requestId);
      db.prepare("UPDATE operations SET status = 'executing' WHERE id = ? AND status = 'pending'").run(current.id);
      return execution;
    });
  }

  function linkExecutionAudit(row: ExecutionOperationRow, execution: ExecutionRow, outcome: "succeeded" | "failed", errorCode?: string): void {
    const auditId = appendAudit(db, {
      actor: row.owner_identity!, clientId: row.client_id, adAccountId: row.ad_account_id, generationId: row.generation_id,
      operation: "execute_operation", correlationId: execution.correlation_id, occurredAt: now().toISOString(), outcome,
      evidence: errorCode === undefined ? { externalRequestId: execution.id } : { errorCode },
    });
    db.prepare(`INSERT INTO operation_execution_audit_links
      (audit_id, operation_id, decision_id, execution_id, event_type) VALUES (?, ?, ?, ?, 'execution')`)
      .run(auditId, row.id, row.decision_id, execution.id);
  }

  function finish(row: ExecutionOperationRow, execution: ExecutionRow, status: "succeeded" | "failed", result: object): Operation {
    transaction(db, () => {
      db.prepare("UPDATE operations SET status = ?, result_json = ? WHERE id = ? AND status = 'executing'")
        .run(status, canonicalPayload(result), row.id);
      const failureCode = status === "failed" && "failure_code" in result && typeof result.failure_code === "string" ? result.failure_code : undefined;
      linkExecutionAudit(row, execution, status === "succeeded" ? "succeeded" : "failed", failureCode);
    });
    return operationView(db, row);
  }

  function pause(row: ExecutionOperationRow, execution: ExecutionRow): Operation {
    transaction(db, () => {
      db.prepare("UPDATE operation_executions SET status = 'reconciliation_required' WHERE id = ? AND status = 'running'").run(execution.id);
      linkExecutionAudit(row, execution, "failed", "ambiguous_write");
    });
    return operationView(db, row);
  }

  async function executionValid(row: ExecutionOperationRow, input: ExecuteInput, execution?: ExecutionRow): Promise<boolean> {
    try {
      await revalidate({ actor: input.actor, requestId: input.requestId, operationId: row.id });
      return true;
    } catch {
      transaction(db, () => {
        db.prepare("UPDATE operations SET status = 'stale' WHERE id = ? AND status IN ('pending', 'executing')").run(row.id);
        if (execution !== undefined) linkExecutionAudit(row, execution, "failed", "operation_stale");
      });
      await cleanupOperationMedia(row.id, "invalid");
      return false;
    }
  }

  async function step(
    row: ExecutionOperationRow,
    execution: ExecutionRow,
    input: ExecuteInput,
    sequence: number,
    stepKey: string,
    kind: string,
    path: string,
    body: unknown,
    parse: (value: unknown) => string | undefined = externalId,
    form?: FormData,
  ): Promise<string> {
    const stored = db.prepare("SELECT status, external_id FROM operation_steps WHERE execution_id = ? AND step_key = ?")
      .get(execution.id, stepKey) as { status: string; external_id: string | null } | undefined;
    if (stored?.status === "succeeded" && stored.external_id !== null) return stored.external_id;
    if (stored !== undefined) throw new Error("reconciliation_required");
    if (!await executionValid(row, input, execution)) throw new OperationError("Operation is stale", 409, "operation_stale");
    testHooks.beforeStepIntent?.(stepKey);
    const correlationId = input.requestId;
    transaction(db, () => {
      assertIdentity(executionOperation(db, row.id));
      db.prepare(`INSERT INTO operation_steps
        (execution_id, operation_id, step_key, sequence, kind, status, request_hash, correlation_id, attempted_at)
        VALUES (?, ?, ?, ?, ?, 'intent', ?, ?, ?)`)
        .run(execution.id, row.id, stepKey, sequence, kind, sha256(canonicalPayload(body)), correlationId, now().toISOString());
    });
    testHooks.afterStepIntent?.(stepKey);
    let persistedId: string;
    try {
      const response = await meta.request({
        method: "POST", path, ...(form === undefined ? { body } : { form }), scope: { clientId: row.client_id, adAccountId: row.ad_account_id, generationId: row.generation_id },
        actor: input.actor, correlationId, operation: `execute_${kind}`,
      });
      testHooks.afterMetaResponse?.(stepKey);
      const id = parse(response.data);
      if (id === undefined) throw new Error("ambiguous_response");
      db.prepare(`UPDATE operation_steps SET status = 'succeeded', external_id = ?, completed_at = ?
        WHERE execution_id = ? AND step_key = ? AND status = 'intent'`)
        .run(id, now().toISOString(), execution.id, stepKey);
      persistedId = id;
    } catch (error) {
      const definitive = error instanceof MetaError && error.status !== undefined && error.status < 500;
      db.prepare(`UPDATE operation_steps SET status = ?, error_code = ?, completed_at = ?
        WHERE execution_id = ? AND step_key = ? AND status = 'intent'`)
        .run(definitive ? "failed" : "reconciliation_required", definitive ? error.code : "ambiguous_write", now().toISOString(), execution.id, stepKey);
      if (definitive) {
        const result = failedResult(row, stepKey, error.status === 429 ? "rate_limited" : "meta_error");
        finish(row, execution, "failed", result);
        if (row.operation_type === "create_campaign_bundle") await cleanupOperationMedia(row.id, "invalid");
      } else {
        pause(row, execution);
      }
      throw error;
    }
    testHooks.afterStepSuccess?.(stepKey);
    return persistedId;
  }

  async function executeCampaign(row: ExecutionOperationRow, execution: ExecutionRow, input: ExecuteInput): Promise<Operation> {
    const payload = JSON.parse(row.payload_json) as Extract<CreateOperationRequest, { type: "create_campaign_bundle" }>["payload"];
    const derived = JSON.parse(row.derived_json) as Record<string, string>;
    if (payload.creative.media.length !== 1) {
      const operation = finish(row, execution, "failed", failedResult(row, "media", "media_invalid"));
      await cleanupOperationMedia(row.id, "invalid");
      return operation;
    }
    const binding = payload.creative.media[0]!;
    let media: Awaited<ReturnType<ExecutionOptions["readMedia"]>>;
    try {
      media = await readMedia({ operationId: row.id, mediaId: binding.media_id, sha256: binding.sha256 });
    } catch {
      const operation = finish(row, execution, "failed", failedResult(row, `media:${binding.media_id}`, "media_invalid"));
      await cleanupOperationMedia(row.id, "invalid");
      return operation;
    }
    const uploadBody = { sha256: binding.sha256, content_type: media.contentType };
    const uploadForm = new FormData();
    const extension = media.contentType === "video/mp4" ? "mp4" : media.contentType === "image/png" ? "png" : "jpg";
    uploadForm.append("source", new Blob([Buffer.from(media.bytes)], { type: media.contentType }), `${binding.media_id}.${extension}`);
    const mediaReference = await step(
      row, execution, input, 0, `media:${binding.media_id}`, media.contentType === "video/mp4" ? "video" : "image",
      `/act_${row.ad_account_id.replace(/^act_/, "")}/${media.contentType === "video/mp4" ? "advideos" : "adimages"}`,
       uploadBody,
      media.contentType === "video/mp4" ? externalId : (value) => {
        if (value === null || typeof value !== "object" || !("images" in value)) return undefined;
        const images = (value as { images?: unknown }).images;
        if (images === null || typeof images !== "object" || Array.isArray(images)) return undefined;
        const hashes = Object.values(images).map((image) => externalId(image, "hash")).filter((hash): hash is string => hash !== undefined);
        return hashes.length === 1 ? hashes[0] : undefined;
      },
      uploadForm,
    );
    const budget = { [`${payload.campaign.budget.kind}_budget`]: amountMinor(payload.campaign.budget.value) };
    const campaignId = await step(row, execution, input, 1, "campaign", "campaign", `/act_${row.ad_account_id.replace(/^act_/, "")}/campaigns`, {
      name: payload.campaign.name, objective: derived.objective, status: "PAUSED", special_ad_categories: [], ...budget,
    });
    const promotedObject = derived.destination === "WEBSITE"
      ? { pixel_id: payload.ad_set.pixel_id, custom_event_type: derived.conversion_event }
      : { page_id: payload.creative.page_id };
    const adSetId = await step(row, execution, input, 2, "ad_set", "ad_set", `/act_${row.ad_account_id.replace(/^act_/, "")}/adsets`, {
      name: payload.ad_set.name, campaign_id: campaignId, billing_event: derived.billing_event,
      optimization_goal: derived.optimization_goal, destination_type: derived.destination,
      promoted_object: promotedObject, targeting: targeting(payload.ad_set.targeting), status: "PAUSED",
      ...(payload.ad_set.start_time === undefined ? {} : { start_time: payload.ad_set.start_time }),
      ...(payload.ad_set.end_time === undefined ? {} : { end_time: payload.ad_set.end_time }),
    });
    const ctaValue = derived.destination === "WEBSITE"
      ? { link: payload.creative.website_url }
      : { lead_gen_form_id: payload.ad_set.lead_gen_form_id };
    const storyData = {
      message: payload.creative.message,
      ...(payload.creative.headline === undefined ? {} : { name: payload.creative.headline }),
      ...(derived.destination === "WEBSITE" ? { link: payload.creative.website_url } : { link: "http://fb.me/" }),
      call_to_action: { type: payload.creative.call_to_action, value: ctaValue },
      ...(media.contentType === "video/mp4" ? { video_id: mediaReference } : { image_hash: mediaReference }),
    };
    const creativeId = await step(row, execution, input, 3, "creative", "creative", `/act_${row.ad_account_id.replace(/^act_/, "")}/adcreatives`, {
      name: payload.creative.name,
      object_story_spec: {
        page_id: payload.creative.page_id,
        ...(payload.creative.instagram_account_id === undefined ? {} : { instagram_user_id: payload.creative.instagram_account_id }),
        [media.contentType === "video/mp4" ? "video_data" : "link_data"]: storyData,
      },
    });
    const adId = await step(row, execution, input, 4, "ad", "ad", `/act_${row.ad_account_id.replace(/^act_/, "")}/ads`, {
      name: payload.ad.name, adset_id: adSetId, creative: { creative_id: creativeId }, status: "PAUSED",
    });
    const completedAt = now().toISOString();
    const operation = finish(row, execution, "succeeded", {
      status: "succeeded", completed_at: completedAt,
      campaign: { object_id: campaignId, delivery_status: "PAUSED" },
      ad_set: { object_id: adSetId, delivery_status: "PAUSED" },
      creative: { object_id: creativeId, bound: true },
      ad: { object_id: adId, delivery_status: "PAUSED" }, next_action: "no_action",
    });
    await cleanupOperationMedia(row.id, "consumed");
    return operation;
  }

  async function executeMutation(row: ExecutionOperationRow, execution: ExecutionRow, input: ExecuteInput): Promise<Operation> {
    if (row.operation_type === "configure_monthly_budget") {
      const payload = JSON.parse(row.payload_json) as components["schemas"]["MonthlyBudgetPayload"];
      const stored = db.prepare("SELECT status FROM operation_steps WHERE execution_id = ? AND step_key = 'configure_monthly_budget'")
        .get(execution.id) as { status: string } | undefined;
      if (stored?.status !== "succeeded") {
        if (!await executionValid(row, input, execution)) throw new OperationError("Operation is stale", 409, "operation_stale");
        const minor = BigInt(amountMinor(payload.monthly_budget));
        if (minor > BigInt(Number.MAX_SAFE_INTEGER)) {
          return finish(row, execution, "failed", failedResult(row, "configure_monthly_budget", "operation_stale"));
        }
        const correlationId = input.requestId;
        transaction(db, () => {
          assertIdentity(executionOperation(db, row.id));
          db.prepare(`INSERT INTO operation_steps
            (execution_id, operation_id, step_key, sequence, kind, status, request_hash, correlation_id, attempted_at)
            VALUES (?, ?, 'configure_monthly_budget', 0, 'configure_monthly_budget', 'intent', ?, ?, ?)`)
            .run(execution.id, row.id, sha256(canonicalPayload(payload)), correlationId, now().toISOString());
          db.prepare(`INSERT INTO budgets (client_id, ad_account_id, amount_minor, currency, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(client_id, ad_account_id) DO UPDATE SET
              amount_minor = excluded.amount_minor, currency = excluded.currency, updated_at = excluded.updated_at`)
            .run(row.client_id, row.ad_account_id, Number(minor), payload.monthly_budget.currency, now().toISOString());
          db.prepare(`UPDATE operation_steps SET status = 'succeeded', external_id = ?, completed_at = ?
            WHERE execution_id = ? AND step_key = 'configure_monthly_budget' AND status = 'intent'`)
            .run(row.ad_account_id, now().toISOString(), execution.id);
        });
        testHooks.afterLocalStepSuccess?.();
      }
    } else {
      const payload = JSON.parse(row.payload_json) as components["schemas"]["UpdateObjectPayload"] | components["schemas"]["ChangeDeliveryPayload"];
      const objectId = String(payload.object_id);
      let body: Record<string, unknown>;
      if (row.operation_type === "change_delivery") {
        const delivery = payload as components["schemas"]["ChangeDeliveryPayload"];
        body = { status: delivery.action === "PAUSE" ? "PAUSED" : "ACTIVE" };
      } else {
        const changes = (payload as components["schemas"]["UpdateObjectPayload"]).changes;
        body = {
          ...("name" in changes && changes.name !== undefined ? { name: changes.name } : {}),
          ...("start_time" in changes && changes.start_time !== undefined ? { start_time: changes.start_time } : {}),
          ...("end_time" in changes && changes.end_time !== undefined ? { end_time: changes.end_time } : {}),
          ...("targeting" in changes && changes.targeting !== undefined ? { targeting: targeting(changes.targeting) } : {}),
          ...("budget" in changes && changes.budget !== undefined ? { [`${changes.budget.kind}_budget`]: amountMinor(changes.budget.value) } : {}),
        };
      }
      await step(row, execution, input, 0, row.operation_type, row.operation_type, `/${objectId}`, body, (value) => {
        return value !== null && typeof value === "object" && (value as { success?: unknown }).success === true ? objectId : undefined;
      });
    }
    return finish(row, execution, "succeeded", { status: "succeeded", completed_at: now().toISOString(), next_action: "no_action" });
  }

  async function execute(input: ExecuteInput): Promise<Operation> {
    const row = executionOperation(db, input.operationId);
    if (row.status === "succeeded" || row.status === "failed") return operationView(db, row);
    if (!await executionValid(row, input)) return operationView(db, row);
    const execution = claim(row, input);
    if (execution === "expired") {
      await cleanupOperationMedia(row.id, "expired");
      return operationView(db, row);
    }
    if (execution === undefined) return operationView(db, row);
    if (row.operation_type === "create_campaign_bundle") {
      try {
        return await executeCampaign(row, execution, input);
      } catch {
        return operationView(db, row);
      }
    }
    try {
      return await executeMutation(row, execution, input);
    } catch {
      return operationView(db, row);
    }
  }

  async function reconcile(input: { actor: string; requestId: string }): Promise<Operation[]> {
    const executions = db.prepare(`SELECT * FROM operation_executions
      WHERE status IN ('running', 'reconciliation_required') ORDER BY claimed_at, id`).all() as unknown as ExecutionRow[];
    const operations: Operation[] = [];
    for (const execution of executions) {
      const row = executionOperation(db, execution.operation_id);
      const unresolved = db.prepare(`SELECT status FROM operation_steps
        WHERE execution_id = ? AND status IN ('intent', 'reconciliation_required') LIMIT 1`)
        .get(execution.id) as { status: string } | undefined;
      if (execution.status === "reconciliation_required" || unresolved !== undefined) {
        transaction(db, () => {
          db.prepare(`UPDATE operation_steps SET status = 'reconciliation_required', error_code = 'ambiguous_write', completed_at = ?
            WHERE execution_id = ? AND status = 'intent'`).run(now().toISOString(), execution.id);
          db.prepare("UPDATE operation_executions SET status = 'reconciliation_required' WHERE id = ? AND status = 'running'").run(execution.id);
        });
        operations.push(operationView(db, row));
        continue;
      }
      try {
        const resumedInput = { actor: input.actor, requestId: execution.correlation_id, operationId: row.id };
        if (!await executionValid(row, resumedInput, execution)) {
          operations.push(operationView(db, row));
          continue;
        }
        operations.push(row.operation_type === "create_campaign_bundle"
          ? await executeCampaign(row, execution, resumedInput)
          : await executeMutation(row, execution, resumedInput));
      } catch {
        operations.push(operationView(db, row));
      }
    }
    return operations;
  }

  return { execute, reconcile };
}

type OperationsService = ReturnType<typeof createOperationsService>;

function supplied(request: unknown): { client_id: string; ad_account_id: string } | undefined {
  if (request === null || typeof request !== "object") return undefined;
  const value = request as Record<string, unknown>;
  return typeof value.client_id === "string" && typeof value.ad_account_id === "string"
    ? { client_id: value.client_id, ad_account_id: value.ad_account_id }
    : undefined;
}

function operationProblem(id: string, error: OperationError, scope?: { client_id: string; ad_account_id: string }): ContractResponse {
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
      const id = requestId(context.request.headers["x-request-id"]);
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
        if (error instanceof OperationError) return operationProblem(id, error, supplied(request));
        throw error;
      }
    },
    getOperation: (context: Context) => {
      const id = requestId(context.request.headers["x-request-id"]);
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
        if (error instanceof OperationError) return operationProblem(id, error);
        throw error;
      }
    },
  };
}
