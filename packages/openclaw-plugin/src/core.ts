import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath, stat } from "node:fs/promises";
import { basename, relative, resolve, sep } from "node:path";
import { spawn } from "node:child_process";
import { Type, type TSchema } from "@sinclair/typebox";

export const TOOL_NAMES = [
  "list_scopes",
  "integration_status",
  "get_capabilities",
  "list_campaigns",
  "query_insights",
  "budget_summary",
  "propose_operation",
  "get_operation",
] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const STAGE_EVENT_TTL_MS = 5 * 60_000;
const MAX_STAGE_EVENTS = 1_024;

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
  senderIsOwner?: boolean;
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

interface TrustedRoot {
  lexical: string;
  actual: string;
  dev: bigint | number;
  ino: bigint | number;
}

async function trustedRoot(root: string): Promise<TrustedRoot> {
  const lexical = resolve(root);
  const rootInfo = await lstat(lexical, { bigint: true });
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error();
  const actual = await realpath(lexical);
  const actualInfo = await stat(actual, { bigint: true });
  if (rootInfo.dev !== actualInfo.dev || rootInfo.ino !== actualInfo.ino) throw new Error();
  return { lexical, actual, dev: rootInfo.dev, ino: rootInfo.ino };
}

async function rootIsUnchanged(root: TrustedRoot) {
  const current = await trustedRoot(root.lexical);
  return current.actual === root.actual && current.dev === root.dev && current.ino === root.ino;
}

export async function readTrustedAttachment(input: { path: string; contentType?: string; roots: string[]; afterOpen?: () => Promise<void> }) {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const pathInfo = await lstat(input.path);
    if (!pathInfo.isFile() || pathInfo.isSymbolicLink()) throw new Error();
    const actualPath = await realpath(input.path);
    const inputPath = resolve(input.path);
    const allowedRoots = await Promise.all(input.roots.map(trustedRoot));
    const allowedRoot = allowedRoots.find((root) => inside(inputPath, root.lexical) && inside(actualPath, root.actual) && relative(root.lexical, inputPath) === relative(root.actual, actualPath));
    if (!allowedRoot) throw new Error();
    handle = await open(actualPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const fileInfo = await handle.stat();
    if (!fileInfo.isFile() || fileInfo.size < 1 || fileInfo.size > MAX_ATTACHMENT_BYTES) throw new Error();
    await input.afterOpen?.();
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (
      after.dev !== fileInfo.dev || after.ino !== fileInfo.ino || after.size !== fileInfo.size ||
      await realpath(input.path) !== actualPath || !await rootIsUnchanged(allowedRoot)
    ) throw new Error();
    return { bytes, filename: basename(actualPath), contentType: input.contentType ?? "application/octet-stream" };
  } catch {
    throw new Error("Trusted attachment is unavailable");
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function trustedIdentity(value: string | undefined): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 4_096 && !/[\u0000-\u001f\u007f-\u009f]/.test(value);
}

function opaqueAttachmentId(values: string[]) {
  const identity = values.map((value) => `${Buffer.byteLength(value)}:${value}`).join("|");
  return `oc_${createHash("sha256").update(identity).digest("hex")}`;
}

interface InboundMediaFact {
  path?: string;
  contentType?: string;
  messageId?: string;
}

interface InboundClaimEvent {
  content: string;
  timestamp?: number;
  channel: string;
  senderId?: string;
  messageId?: string;
  commandAuthorized?: boolean;
  senderIsOwner?: boolean;
  mediaStagingPending?: boolean;
  media?: InboundMediaFact[];
}

interface InboundClaimContext {
  channelId: string;
  accountId?: string;
  conversationId?: string;
  senderId?: string;
  messageId?: string;
}

const STAGE_COMMAND = "/stage-ad-media";
const SUPPORTED_ATTACHMENT_TYPES = new Set(["image/jpeg", "image/png", "video/mp4"]);

type StageMediaResult = { handled: boolean; reply?: { text: string } };
interface StageEventEntry {
  expiresAt: number;
  settled: boolean;
  result: Promise<StageMediaResult>;
}

export function createStageMediaCommandHandler() {
  const events = new Map<string, StageEventEntry>();

  return async function handleStageMediaCommand(input: {
    event: InboundClaimEvent;
    context: InboundClaimContext;
    config: PluginConfig;
    ownerAllowFrom?: string[];
    gateway: Gateway;
    now?: () => number;
  }): Promise<StageMediaResult> {
    if (input.event.content !== STAGE_COMMAND && !input.event.content.startsWith(`${STAGE_COMMAND} `)) return { handled: false };
    const match = /^\/stage-ad-media ([A-Za-z0-9][A-Za-z0-9._:-]{0,254}) ([A-Za-z0-9][A-Za-z0-9._:-]{0,254})$/.exec(input.event.content);
    if (!match) return { handled: true, reply: { text: "Usage: /stage-ad-media <client_id> <ad_account_id>" } };

    const { event, context } = input;
    const owner = trustedIdentity(context.senderId) ? `${context.channelId}:${context.senderId}` : "";
    if (
      event.commandAuthorized !== true || event.senderIsOwner !== true || input.ownerAllowFrom?.length !== 1 || input.ownerAllowFrom[0] !== owner ||
      event.channel !== context.channelId || event.senderId !== context.senderId || event.messageId !== context.messageId
    ) return { handled: true, reply: { text: "Command sender is not authorized." } };

    if (!trustedIdentity(event.messageId)) return { handled: true, reply: { text: "Media staging failed: exactly one fresh supported attachment is required." } };
    const now = (input.now ?? Date.now)();
    const eventKey = opaqueAttachmentId([context.channelId, context.accountId ?? "", context.conversationId ?? "", context.senderId!, event.messageId, match[1]!, match[2]!]);
    const existing = events.get(eventKey);
    if (existing && (!existing.settled || existing.expiresAt >= now)) return existing.result;
    if (existing) events.delete(eventKey);
    for (const [key, eventEntry] of events) if (eventEntry.settled && eventEntry.expiresAt < now) events.delete(key);
    if (events.size >= MAX_STAGE_EVENTS) return { handled: true, reply: { text: "Media staging failed." } };

    const entry = { expiresAt: now + STAGE_EVENT_TTL_MS, settled: false } as StageEventEntry;
    entry.result = (async () => {
      const media = event.media;
      if (
        event.mediaStagingPending === true || !Number.isFinite(event.timestamp) || event.timestamp! > now ||
        now - event.timestamp! > STAGE_EVENT_TTL_MS || media?.length !== 1 || !trustedIdentity(media[0]!.path) ||
        !SUPPORTED_ATTACHMENT_TYPES.has(media[0]!.contentType ?? "") || media[0]!.messageId !== undefined && media[0]!.messageId !== event.messageId
      ) return { handled: true, reply: { text: "Media staging failed: exactly one fresh supported attachment is required." } };

      let attachment: Awaited<ReturnType<typeof readTrustedAttachment>> | undefined;
      try {
        attachment = await readTrustedAttachment({ path: media[0]!.path!, contentType: media[0]!.contentType!, roots: input.config.attachmentRoots });
        const form = new FormData();
        form.set("client_id", match[1]!);
        form.set("ad_account_id", match[2]!);
        form.set("attachment", JSON.stringify({
          source: "openclaw_chat_attachment",
          attachment_id: opaqueAttachmentId([context.channelId, context.accountId ?? "", context.conversationId ?? "", context.senderId!, context.messageId!, "0"]),
          original_filename: attachment.filename,
          declared_content_type: attachment.contentType,
        }));
        form.set("file", new Blob([attachment.bytes], { type: attachment.contentType }), attachment.filename);
        const result = await input.gateway.request("POST", "/v1/media", { form });
        const mediaResult = result.media as Record<string, unknown> | undefined;
        const scope = result.scope as Record<string, unknown> | undefined;
        const expiresAt = typeof mediaResult?.expires_at === "string" ? mediaResult.expires_at : "";
        if (
          !mediaResult || !scope || scope.client_id !== match[1] || scope.ad_account_id !== match[2] ||
          !trustedIdentity(mediaResult.media_id as string | undefined) || !/^[a-f0-9]{64}$/.test(String(mediaResult.sha256 ?? "")) ||
          !SUPPORTED_ATTACHMENT_TYPES.has(String(mediaResult.content_type ?? "")) || !Number.isSafeInteger(mediaResult.size_bytes) ||
          Number(mediaResult.size_bytes) < 1 || Number(mediaResult.size_bytes) > MAX_ATTACHMENT_BYTES ||
          !trustedIdentity(expiresAt) || new Date(expiresAt).toISOString() !== expiresAt || !trustedIdentity(result.request_id as string | undefined)
        ) throw new Error("Gateway returned an invalid response");
        return { handled: true, reply: { text: `Staged ${mediaResult.media_id} (${mediaResult.content_type}, ${mediaResult.size_bytes} bytes, SHA-256 ${mediaResult.sha256}) for ${match[1]}/${match[2]}; expires ${expiresAt}. Request ${result.request_id}.` } };
      } catch (error) {
        const suffix = error instanceof GatewayProblem ? ` HTTP ${error.status}. Request ${error.requestId}.` : "";
        return { handled: true, reply: { text: `Media staging failed.${suffix}` } };
      } finally {
        attachment?.bytes.fill(0);
      }
    })();
    events.set(eventKey, entry);
    void entry.result.finally(() => { entry.settled = true; });
    return entry.result;
  };
}

export const handleStageMediaCommand = createStageMediaCommandHandler();

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
      if (!ctx.isAuthorizedSender || ctx.senderIsOwner !== true || allow.length !== 1 || allow[0] !== owner) return { text: "Command sender is not authorized." };
      const operationId = optionalString(ctx.args)?.trim() ?? "";
      if (!UUID.test(operationId)) return { text: "Expected one canonical operation UUID." };
      try {
        const scope = await findOperationScope(gateway, operationId);
        const query = new URLSearchParams(scope).toString();
        const path = `/v1/operations/${operationId}/${decision === "approved" ? "approve" : "reject"}?${query}`;
        const secret = await gateway.secret(input.config.ownerProofAccount);
        const result = await gateway.request("POST", path, { headers: { "x-openclaw-owner-command": proof(secret, { method: "POST", path, decision, operationId, owner }) } });
        const operation = result.operation !== null && typeof result.operation === "object" ? result.operation as Record<string, unknown> : undefined;
        const resultState = operation?.result !== null && typeof operation?.result === "object"
          ? (operation.result as Record<string, unknown>).status
          : undefined;
        const status = typeof resultState === "string"
          ? resultState
          : typeof operation?.execution_state === "string"
            ? `${String(operation.status)} (${operation.execution_state})`
            : typeof operation?.status === "string" ? operation.status : "unknown";
        const requestId = typeof result.request_id === "string" ? ` Request ${result.request_id}.` : "";
        return { text: `Operation ${operationId}: ${status}.${requestId}` };
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
