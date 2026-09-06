import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { lstat, readFile, realpath, stat } from "node:fs/promises";
import { basename, relative, sep } from "node:path";
import { spawn } from "node:child_process";
import { Type, type TSchema } from "@sinclair/typebox";

export const TOOL_NAMES = [
  "list_scopes",
  "integration_status",
  "get_capabilities",
  "list_campaigns",
  "query_insights",
  "budget_summary",
  "upload_chat_media",
  "propose_operation",
  "get_operation",
] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export interface PluginConfig {
  baseUrl: string;
  keychainService: string;
  serviceTokenAccount: string;
  ownerProofAccount: string;
  attachmentRoots: string[];
  timeoutMs?: number;
}

interface RequestOptions {
  query?: Record<string, string | number | undefined>;
  headers?: Record<string, string>;
  json?: unknown;
  form?: FormData;
}

export interface Gateway {
  request(method: "GET" | "POST", path: string, options?: RequestOptions): Promise<Record<string, unknown>>;
  secret(account: string): Promise<string>;
}

interface ToolContext {
  messageChannel?: string;
  requesterSenderId?: string;
  agentAccountId?: string;
  deliveryContext?: { channel?: string; to?: string; accountId?: string; threadId?: string | number };
}

interface ToolDefinition {
  name: string;
  description: string;
  parameters: TSchema;
  execute(id: string, params: Record<string, unknown>): Promise<unknown>;
}

class GatewayProblem extends Error {
  constructor(readonly status: number, readonly requestId: string) {
    super("Gateway request failed");
  }
}

interface CommandContext {
  senderId?: string;
  channel: string;
  isAuthorizedSender: boolean;
  args?: string;
  config: { commands?: { ownerAllowFrom?: string[] } };
}

interface CommandDefinition {
  name: string;
  description: string;
  acceptsArgs: true;
  requireAuth: true;
  handler(ctx: CommandContext): Promise<{ text: string }>;
}

function scoped(properties: Record<string, ReturnType<typeof Type.String>> = {}) {
  return Type.Object({
    client_id: Type.String({ minLength: 1 }),
    ad_account_id: Type.String({ minLength: 1 }),
    ...properties,
  }, { additionalProperties: false });
}

function asString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${name} is required`);
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function queryOf(params: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(keys.flatMap((key) => {
    const value = params[key];
    return typeof value === "string" || typeof value === "number" ? [[key, value]] : [];
  }));
}

function toolResult(data: Record<string, unknown>) {
  return { content: [{ type: "text", text: JSON.stringify(data) }], details: data };
}

export function assertLoopbackBaseUrl(raw: string): URL {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("Invalid loopback gateway URL"); }
  if (
    url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.username || url.password ||
    (url.pathname !== "/" && url.pathname !== "") || url.search || url.hash ||
    (url.port && (Number(url.port) < 1 || Number(url.port) > 65_535))
  ) throw new Error("Invalid loopback gateway URL");
  return url;
}

export function createGatewayClient(options: {
  baseUrl: string;
  getServiceToken: () => Promise<string>;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}): Gateway {
  const base = assertLoopbackBaseUrl(options.baseUrl);
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  return {
    secret: async () => { throw new Error("Secret account is unavailable"); },
    async request(method, path, request = {}) {
      if (!path.startsWith("/") || path.startsWith("//")) throw new Error("Invalid gateway path");
      const url = new URL(path, base);
      if (url.origin !== base.origin) throw new Error("Invalid gateway path");
      for (const [key, value] of Object.entries(request.query ?? {})) if (value !== undefined) url.searchParams.set(key, String(value));
      let token = await options.getServiceToken();
      const outboundRequestId = randomUUID();
      const headers = new Headers(request.headers);
      headers.set("authorization", `Bearer ${token}`);
      headers.set("x-request-id", outboundRequestId);
      let body: BodyInit | undefined;
      if (request.form !== undefined) body = request.form;
      else if (request.json !== undefined) {
        headers.set("content-type", "application/json");
        body = JSON.stringify(request.json);
      }
      const controller = new AbortController();
      let rejectTimeout: (error: Error) => void = () => undefined;
      const timeout = new Promise<never>((_, reject) => { rejectTimeout = reject; });
      const timer = setTimeout(() => {
        controller.abort();
        rejectTimeout(new Error("Gateway request timed out"));
      }, timeoutMs);
      let response: Response;
      try {
        response = await Promise.race([
          fetchImpl(url, { method, headers, ...(body === undefined ? {} : { body }), redirect: "manual", signal: controller.signal }),
          timeout,
        ]);
        if (response.status >= 300 && response.status < 400) throw new Error("Gateway redirect refused");
        const declared = Number(response.headers.get("content-length") ?? "0");
        if (!Number.isFinite(declared) || declared > MAX_RESPONSE_BYTES) throw new Error("Gateway response too large");
        const reader = response.body?.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        try {
          if (reader) while (true) {
            const part = await Promise.race([reader.read(), timeout]);
            if (part.done) break;
            size += part.value.length;
            if (size > MAX_RESPONSE_BYTES) throw new Error("Gateway response too large");
            chunks.push(part.value);
          }
        } catch (error) {
          await reader?.cancel().catch(() => undefined);
          throw error;
        }
        const text = Buffer.concat(chunks).toString("utf8");
        let data: unknown;
        try { data = text ? JSON.parse(text) : {}; } catch { throw new Error("Gateway returned an invalid response"); }
        if (data === null || typeof data !== "object" || Array.isArray(data)) throw new Error("Gateway returned an invalid response");
        const result = data as Record<string, unknown>;
        const responseRequestId = response.headers.get("x-request-id");
        if (responseRequestId !== outboundRequestId || (result.request_id !== undefined && result.request_id !== outboundRequestId)) {
          throw new Error("Gateway response correlation failed");
        }
        if (!response.ok) throw new GatewayProblem(response.status, outboundRequestId);
        return result.request_id === undefined ? { ...result, request_id: outboundRequestId } : result;
      } catch (error) {
        if (error instanceof GatewayProblem) throw error;
        if (error instanceof Error && /Gateway (redirect refused|response too large|response correlation failed|returned an invalid response)/.test(error.message)) throw error;
        throw new Error("Gateway request failed");
      } finally {
        clearTimeout(timer);
        token = "";
      }
    },
  };
}

export function createKeychainSecretProvider(service: string, timeoutMs = 10_000) {
  return async (account: string): Promise<string> => new Promise((resolve, reject) => {
    if (!service || !account || /[\0\r\n]/.test(service + account)) return reject(new Error("Invalid Keychain reference"));
    const child = spawn("/usr/bin/security", ["find-generic-password", "-a", account, "-s", service, "-w"], { stdio: ["ignore", "pipe", "ignore"] });
    const chunks: Buffer[] = [];
    let size = 0;
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 65_536) child.kill("SIGKILL");
      else chunks.push(chunk);
    });
    child.once("error", () => { clearTimeout(timer); reject(new Error("Keychain secret unavailable")); });
    child.once("close", (code) => {
      clearTimeout(timer);
      const value = Buffer.concat(chunks);
      if (code !== 0 || size > 65_536 || value.length === 0) { value.fill(0); reject(new Error("Keychain secret unavailable")); return; }
      const secret = value.toString("utf8").replace(/[\r\n]+$/, "");
      value.fill(0);
      resolve(secret);
    });
  });
}

function inside(path: string, root: string) {
  const child = relative(root, path);
  return child === "" || (!child.startsWith(`..${sep}`) && child !== ".." && !child.startsWith(sep));
}

export async function readTrustedAttachment(input: { path: string; contentType?: string; roots: string[] }) {
  try {
    const pathInfo = await lstat(input.path);
    if (!pathInfo.isFile() || pathInfo.isSymbolicLink()) throw new Error();
    const actualPath = await realpath(input.path);
    const allowedRoots = await Promise.all(input.roots.map((root) => realpath(root)));
    if (!allowedRoots.some((root) => inside(actualPath, root))) throw new Error();
    const fileInfo = await stat(actualPath);
    if (!fileInfo.isFile() || fileInfo.size < 1 || fileInfo.size > MAX_ATTACHMENT_BYTES) throw new Error();
    const bytes = await readFile(actualPath);
    return { bytes, filename: basename(actualPath), contentType: input.contentType ?? "application/octet-stream" };
  } catch {
    throw new Error("Trusted attachment is unavailable");
  }
}

type AttachmentFact = {
  path: string;
  contentType?: string;
  source: "openclaw_chat_attachment";
  attachmentId: string;
  expiresAt: number;
};

function trustedIdentity(value: string | undefined): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 4_096 && !/[\0\r\n]/.test(value);
}

function opaqueAttachmentId(key: string, channel: string, messageId: string, index: number) {
  const identity = [key, channel, messageId, String(index)].map((value) => `${Buffer.byteLength(value)}:${value}`).join("|");
  return `oc_${createHash("sha256").update(identity).digest("hex")}`;
}

export class TrustedAttachmentStore {
  readonly #entries = new Map<string, AttachmentFact[]>();
  constructor(private readonly roots: string[], private readonly now = () => Date.now()) {}

  capture(
    key: string | undefined,
    paths: string[],
    contentTypes: string[] = [],
    identity?: { channel?: string; messageId?: string },
  ) {
    const channel = identity?.channel;
    const messageId = identity?.messageId;
    if (!key || !trustedIdentity(channel) || !trustedIdentity(messageId)) return;
    const facts = paths.map((path, index) => ({
      path,
      ...(contentTypes[index] ? { contentType: contentTypes[index] } : {}),
      source: "openclaw_chat_attachment" as const,
      attachmentId: opaqueAttachmentId(key, channel, messageId, index),
      expiresAt: this.now() + 5 * 60_000,
    }));
    this.#entries.set(key, facts);
  }

  async take(key: string | undefined) {
    const facts = key ? this.#entries.get(key) : undefined;
    if (!key || !facts || facts.length !== 1 || facts[0]!.expiresAt < this.now()) throw new Error("Exactly one fresh trusted attachment is required");
    this.#entries.delete(key);
    const fact = facts[0]!;
    return { ...(await readTrustedAttachment({ ...fact, roots: this.roots })), source: fact.source, attachmentId: fact.attachmentId };
  }
}

export function attachmentContextKey(input: { channel?: string | undefined; account?: string | undefined; conversation?: string | undefined; sender?: string | undefined }): string | undefined {
  const values = [input.channel, input.account, input.conversation, input.sender];
  if (values.some((value) => typeof value !== "string" || value.length === 0 || /[\0\r\n]/.test(value))) return undefined;
  return values.map((value) => `${Buffer.byteLength(value!)}:${value}`).join("|");
}

function contextKey(context: ToolContext | undefined) {
  if (!context) return undefined;
  return attachmentContextKey({
    channel: context.messageChannel ?? context.deliveryContext?.channel,
    account: context.agentAccountId ?? context.deliveryContext?.accountId,
    conversation: context.deliveryContext?.to,
    sender: context.requesterSenderId,
  });
}

function proof(secret: string, input: { method: string; path: string; decision: "approved" | "rejected"; operationId: string; owner: string }) {
  const issuedAt = Math.floor(Date.now() / 1000).toString();
  const nonce = randomBytes(16).toString("base64url");
  const encodedOwner = Buffer.from(input.owner).toString("base64url");
  const bodyHash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
  const signature = createHmac("sha256", Buffer.from(secret, "base64"))
    .update(["v1", input.method, input.path, input.decision, input.operationId, bodyHash, input.owner, issuedAt, nonce].join("\n"))
    .digest("base64url");
  return `v1.${issuedAt}.${nonce}.${encodedOwner}.${signature}`;
}

async function findOperationScope(gateway: Gateway, operationId: string) {
  let cursor: string | undefined;
  do {
    const page = await gateway.request("GET", "/v1/scopes", { query: { limit: 100, cursor } });
    const scopes = Array.isArray(page.data) ? page.data : [];
    for (const item of scopes) {
      if (item === null || typeof item !== "object") continue;
      const record = item as Record<string, unknown>;
      if (typeof record.client_id !== "string" || typeof record.ad_account_id !== "string") continue;
      try {
        await gateway.request("GET", `/v1/operations/${operationId}`, { query: { client_id: record.client_id, ad_account_id: record.ad_account_id } });
        return { client_id: record.client_id, ad_account_id: record.ad_account_id };
      } catch { /* keep searching explicit authorized scopes */ }
    }
    const next = page.page && typeof page.page === "object" ? (page.page as Record<string, unknown>).next_cursor : undefined;
    cursor = typeof next === "string" ? next : undefined;
  } while (cursor);
  throw new Error("Operation was not found in an authorized scope");
}

export function createOpenClawRegistration(input: {
  config: PluginConfig;
  gateway: Gateway;
  attachments?: TrustedAttachmentStore;
  toolContext?: ToolContext;
}) {
  const { gateway } = input;
  const page = { cursor: Type.Optional(Type.String()), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })) };
  const scopeFrom = (params: Record<string, unknown>) => typeof params.client_id === "string" && typeof params.ad_account_id === "string"
    ? { client_id: params.client_id, ad_account_id: params.ad_account_id }
    : undefined;
  const modelResult = async (params: Record<string, unknown>, work: () => Promise<Record<string, unknown>>) => {
    try {
      return toolResult(await work());
    } catch (error) {
      if (!(error instanceof GatewayProblem)) throw error;
      const remediation = error.status === 409
        ? "Verify client_id and ad_account_id are an authorized pair, then retry."
        : error.status === 422
          ? "Correct the tool input and retry."
          : error.status === 429
            ? "Wait before retrying the scoped request."
            : "Use request_id to inspect the local gateway and retry when it is healthy.";
      return toolResult({
        request_id: error.requestId,
        ...(scopeFrom(params) === undefined ? {} : { supplied_scope: scopeFrom(params) }),
        error: { status: error.status, code: "gateway_request_failed", remediation },
      });
    }
  };
  const globalBudget = async (params: Record<string, unknown>) => {
    const data: Record<string, unknown>[] = [];
    const seen = new Set<string>();
    let cursor: string | undefined;
    do {
      if (cursor !== undefined && seen.has(cursor)) throw new Error("Gateway returned a repeated scope cursor");
      if (cursor !== undefined) seen.add(cursor);
      const scopes = await gateway.request("GET", "/v1/scopes", { query: { limit: typeof params.limit === "number" ? params.limit : 100, cursor } });
      if (!Array.isArray(scopes.data)) throw new Error("Gateway returned invalid scopes");
      for (const value of scopes.data) {
        if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Gateway returned invalid scopes");
        const item = value as Record<string, unknown>;
        const clientId = asString(item.client_id, "client_id");
        const adAccountId = asString(item.ad_account_id, "ad_account_id");
        const response = await gateway.request("GET", "/v1/budget-pacing", {
          query: { client_id: clientId, ad_account_id: adAccountId, as_of: optionalString(params.as_of) },
        });
        data.push(response);
      }
      const next = scopes.page && typeof scopes.page === "object" ? (scopes.page as Record<string, unknown>).next_cursor : undefined;
      cursor = typeof next === "string" && next.length > 0 ? next : undefined;
    } while (cursor !== undefined);
    return { composition: "independent_scoped_pacing", data };
  };
  const tools: ToolDefinition[] = [
    { name: "list_scopes", description: "List authorized client and Ad Account pairs.", parameters: Type.Object(page, { additionalProperties: false }), execute: async (_id, p) => modelResult(p, () => gateway.request("GET", "/v1/scopes", { query: queryOf(p, ["cursor", "limit"]) })) },
    { name: "integration_status", description: "Get safe integration diagnostics.", parameters: Type.Union([Type.Object({}, { additionalProperties: false }), scoped()]), execute: async (_id, p) => modelResult(p, () => gateway.request("GET", "/v1/integration-status", { query: queryOf(p, ["client_id", "ad_account_id"]) })) },
    { name: "get_capabilities", description: "Discover usable assets and campaign capabilities for one scope.", parameters: scoped({ cursor: Type.Optional(Type.String()) as never, limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })) as never, asset_type: Type.Optional(Type.String()) as never }), execute: async (_id, p) => modelResult(p, () => gateway.request("GET", "/v1/capabilities", { query: queryOf(p, ["client_id", "ad_account_id", "cursor", "limit", "asset_type"]) })) },
    { name: "list_campaigns", description: "List campaigns for one explicit scope.", parameters: scoped({ cursor: Type.Optional(Type.String()) as never, limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })) as never, status: Type.Optional(Type.Union([Type.Literal("ACTIVE"), Type.Literal("PAUSED"), Type.Literal("ARCHIVED"), Type.Literal("DELETED")])) as never }), execute: async (_id, p) => modelResult(p, () => gateway.request("GET", "/v1/campaigns", { query: queryOf(p, ["client_id", "ad_account_id", "cursor", "limit", "status"]) })) },
    { name: "query_insights", description: "Query scoped Insights without approval.", parameters: scoped({ since: Type.String() as never, until: Type.String() as never, level: Type.Union([Type.Literal("account"), Type.Literal("campaign")]) as never, cursor: Type.Optional(Type.String()) as never, limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })) as never }), execute: async (_id, p) => modelResult(p, () => gateway.request("POST", "/v1/insights/query", { query: queryOf(p, ["cursor", "limit"]), json: { client_id: asString(p.client_id, "client_id"), ad_account_id: asString(p.ad_account_id, "ad_account_id"), date_range: { since: asString(p.since, "since"), until: asString(p.until, "until") }, level: asString(p.level, "level") } })) },
    { name: "budget_summary", description: "Get independent monthly pacing for one scope or all authorized scopes.", parameters: Type.Union([
      scoped({ as_of: Type.Optional(Type.String({ format: "date-time" })) as never }),
      Type.Object({ global: Type.Literal(true), as_of: Type.Optional(Type.String({ format: "date-time" })), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })) }, { additionalProperties: false }),
    ]), execute: async (_id, p) => modelResult(p, () => p.global === true ? globalBudget(p) : gateway.request("GET", "/v1/budget-pacing", { query: queryOf(p, ["client_id", "ad_account_id", "as_of"]) })) },
    { name: "upload_chat_media", description: "Stage exactly one fresh host-trusted inbound attachment.", parameters: scoped(), execute: async (_id, p) => {
      if (!input.attachments) throw new Error("Trusted attachment context is unavailable");
      const attachment = await input.attachments.take(contextKey(input.toolContext));
      try {
        const form = new FormData();
        form.set("client_id", asString(p.client_id, "client_id"));
        form.set("ad_account_id", asString(p.ad_account_id, "ad_account_id"));
        form.set("attachment", JSON.stringify({
          source: attachment.source,
          attachment_id: attachment.attachmentId,
          original_filename: attachment.filename,
          declared_content_type: attachment.contentType,
        }));
        form.set("file", new Blob([attachment.bytes], { type: attachment.contentType }), attachment.filename);
        return await modelResult(p, () => gateway.request("POST", "/v1/media", { form }));
      } finally { attachment.bytes.fill(0); }
    } },
    { name: "propose_operation", description: "Create an immutable pending operation; never approves or executes it.", parameters: scoped({ idempotency_key: Type.String({ minLength: 1 }) as never, type: Type.Union([Type.Literal("create_campaign_bundle"), Type.Literal("update_object"), Type.Literal("change_delivery"), Type.Literal("configure_monthly_budget")]) as never, payload: Type.Unknown() as never }), execute: async (_id, p) => modelResult(p, () => gateway.request("POST", "/v1/operations", { headers: { "idempotency-key": asString(p.idempotency_key, "idempotency_key") }, json: { client_id: asString(p.client_id, "client_id"), ad_account_id: asString(p.ad_account_id, "ad_account_id"), type: asString(p.type, "type"), payload: p.payload } })) },
    { name: "get_operation", description: "Get one operation in an explicit scope.", parameters: scoped({ operation_id: Type.String({ pattern: UUID.source }) as never }), execute: async (_id, p) => modelResult(p, () => gateway.request("GET", `/v1/operations/${asString(p.operation_id, "operation_id")}`, { query: queryOf(p, ["client_id", "ad_account_id"]) })) },
  ];

  const command = (name: "approve-ad" | "reject-ad", decision: "approved" | "rejected"): CommandDefinition => ({
    name,
    description: `${decision === "approved" ? "Approve" : "Reject"} one immutable Meta Ads operation.`,
    acceptsArgs: true,
    requireAuth: true,
    async handler(ctx) {
      const owner = ctx.senderId ? `${ctx.channel}:${ctx.senderId}` : "";
      const allow = ctx.config.commands?.ownerAllowFrom ?? [];
      if (!ctx.isAuthorizedSender || allow.length !== 1 || allow[0] !== owner) return { text: "Command sender is not authorized." };
      const operationId = optionalString(ctx.args)?.trim() ?? "";
      if (!UUID.test(operationId)) return { text: "Expected one canonical operation UUID." };
      try {
        const scope = await findOperationScope(gateway, operationId);
        const query = new URLSearchParams(scope).toString();
        const path = `/v1/operations/${operationId}/${decision === "approved" ? "approve" : "reject"}?${query}`;
        const secret = await gateway.secret(input.config.ownerProofAccount);
        try {
          const result = await gateway.request("POST", path, { headers: { "x-openclaw-owner-command": proof(secret, { method: "POST", path, decision, operationId, owner }) } });
          const status = typeof result.status === "string" ? result.status : decision;
          const requestId = typeof result.request_id === "string" ? ` Request ${result.request_id}.` : "";
          return { text: `Operation ${operationId}: ${status}.${requestId}` };
        } finally { secret.replace(/./g, "0"); }
      } catch (error) {
        return { text: error instanceof Error ? error.message : "Owner command failed" };
      }
    },
  });

  return { tools, commands: [command("approve-ad", "approved"), command("reject-ad", "rejected")] };
}

export function parsePluginConfig(value: unknown): PluginConfig {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Plugin configuration is required");
  const input = value as Record<string, unknown>;
  const allowed = new Set(["baseUrl", "keychainService", "serviceTokenAccount", "ownerProofAccount", "attachmentRoots", "timeoutMs"]);
  if (Object.keys(input).some((key) => !allowed.has(key))) throw new Error("Unknown plugin configuration field");
  const roots = input.attachmentRoots;
  if (!Array.isArray(roots) || roots.length === 0 || roots.some((root) => typeof root !== "string" || !root)) throw new Error("attachmentRoots is required");
  const timeoutMs = input.timeoutMs;
  if (timeoutMs !== undefined && (!Number.isInteger(timeoutMs) || Number(timeoutMs) < 1000 || Number(timeoutMs) > 30_000)) throw new Error("Invalid timeoutMs");
  const config = {
    baseUrl: asString(input.baseUrl, "baseUrl"),
    keychainService: asString(input.keychainService, "keychainService"),
    serviceTokenAccount: asString(input.serviceTokenAccount, "serviceTokenAccount"),
    ownerProofAccount: asString(input.ownerProofAccount, "ownerProofAccount"),
    attachmentRoots: roots as string[],
    ...(timeoutMs === undefined ? {} : { timeoutMs: Number(timeoutMs) }),
  };
  assertLoopbackBaseUrl(config.baseUrl);
  return config;
}
