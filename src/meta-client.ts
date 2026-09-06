import { createHmac } from "node:crypto";
import type { AuditEvent } from "./db.js";

const graphOrigin = "https://graph.facebook.com";
const graphVersion = "v26.0";

export interface MetaScope {
  clientId: string;
  adAccountId: string;
  generationId: string;
}

export interface MetaCredentials {
  accessToken: string;
  appSecret: string;
}

export interface MetaRateEvidence {
  retryAfterSeconds?: number;
  appUsage?: unknown;
  adAccountUsage?: unknown;
  businessUseCaseUsage?: unknown;
}

export interface MetaRequest {
  method: "GET" | "POST";
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  form?: FormData;
  scope: MetaScope;
  actor: string;
  correlationId: string;
  operation: string;
}

export interface MetaPageRequest extends Omit<MetaRequest, "method" | "body" | "form"> {}

export interface AsyncInsightsRequest extends MetaPageRequest {}

export class MetaError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status?: number,
    readonly retryAfterSeconds?: number,
    readonly transient = false,
  ) {
    super(message);
    this.name = "MetaError";
  }
}

export interface MetaClientOptions {
  fetch: typeof globalThis.fetch;
  getCredentials: (scope: MetaScope) => Promise<MetaCredentials>;
  audit: (event: AuditEvent) => Promise<unknown> | unknown;
  now?: () => Date;
  sleep?: (milliseconds: number) => Promise<void>;
  random?: () => number;
  timeoutMs?: number;
  maxAttempts?: number;
  maxPages?: number;
  maxPolls?: number;
}

interface MetaEnvelope<T> {
  data: T[];
  paging?: { cursors?: { after?: string } };
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Invalid ${name}`);
  return value;
}

function safePath(path: string): string {
  if (!/^\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(path)) throw new Error("Invalid Meta path");
  return path;
}

function safeHeader(value: string | null): string | undefined {
  return value !== null && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(value) ? value : undefined;
}

function usage(value: string | null): unknown {
  if (value === null || value.length > 16_384) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed !== null && typeof parsed === "object" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function retryAfterSeconds(value: string | null, now: Date): number | undefined {
  if (value === null) return undefined;
  if (/^\d+$/.test(value)) return Math.min(Number(value), 86_400);
  const instant = Date.parse(value);
  return Number.isNaN(instant) ? undefined : Math.min(Math.max(0, Math.ceil((instant - now.getTime()) / 1_000)), 86_400);
}

function rateEvidence(headers: Headers, now: Date): MetaRateEvidence {
  const retryAfter = retryAfterSeconds(headers.get("retry-after"), now);
  const appUsage = usage(headers.get("x-app-usage"));
  const adAccountUsage = usage(headers.get("x-ad-account-usage"));
  const businessUseCaseUsage = usage(headers.get("x-business-use-case-usage"));
  return {
    ...(retryAfter === undefined ? {} : { retryAfterSeconds: retryAfter }),
    ...(appUsage === undefined ? {} : { appUsage }),
    ...(adAccountUsage === undefined ? {} : { adAccountUsage }),
    ...(businessUseCaseUsage === undefined ? {} : { businessUseCaseUsage }),
  };
}

function metaFailure(value: unknown): { code: string; transient: boolean } {
  if (value !== null && typeof value === "object" && "error" in value) {
    const error = (value as { error?: unknown }).error;
    if (error !== null && typeof error === "object") {
      const code = (error as { code?: unknown }).code;
      return {
        code: typeof code === "number" && Number.isSafeInteger(code) ? `meta_${code}` : "upstream_error",
        transient: (error as { is_transient?: unknown }).is_transient === true,
      };
    }
  }
  return { code: "upstream_error", transient: false };
}

function formValue(value: unknown): string {
  return value !== null && typeof value === "object" ? JSON.stringify(value) : String(value);
}

async function responseBody(response: Response, signal: AbortSignal): Promise<unknown> {
  if (response.body === null) return null;
  if (signal.aborted) {
    await response.body.cancel().catch(() => undefined);
    throw new DOMException("The operation was aborted", "AbortError");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      if (signal.aborted) throw new DOMException("The operation was aborted", "AbortError");
      const result = await new Promise<ReadableStreamReadResult<Uint8Array>>((resolve, reject) => {
        const abort = () => reject(new DOMException("The operation was aborted", "AbortError"));
        signal.addEventListener("abort", abort, { once: true });
        reader.read().then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
      });
      if (result.done) break;
      size += result.value.byteLength;
      if (size > 10 * 1024 * 1024) throw new Error("Meta response body is too large");
      chunks.push(result.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  const text = new TextDecoder().decode(Buffer.concat(chunks));
  if (text.length === 0) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

export function createMetaClient(options: MetaClientOptions) {
  const now = options.now ?? (() => new Date());
  const sleep = options.sleep ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const random = options.random ?? Math.random;
  const timeoutMs = positiveInteger(options.timeoutMs ?? 10_000, "timeout");
  const maxAttempts = positiveInteger(options.maxAttempts ?? 3, "attempt limit");
  const maxPages = positiveInteger(options.maxPages ?? 100, "page limit");
  const maxPolls = positiveInteger(options.maxPolls ?? 60, "poll limit");

  async function audit(request: MetaRequest, outcome: AuditEvent["outcome"], evidence: AuditEvent["evidence"] = {}) {
    await options.audit({
      actor: request.actor,
      clientId: request.scope.clientId,
      adAccountId: request.scope.adAccountId,
      generationId: request.scope.generationId,
      operation: request.operation,
      correlationId: request.correlationId,
      occurredAt: now().toISOString(),
      outcome,
      evidence,
    });
  }

  async function once<T>(request: MetaRequest): Promise<{ data: T; rate: MetaRateEvidence }> {
    if (request.body !== undefined && request.form !== undefined) throw new Error("Meta request body is ambiguous");
    if (Object.keys(request.query ?? {}).some((name) => /^(?:access_token|app_?secret|appsecret_proof)$/i.test(name))) {
      throw new Error("Reserved Meta query parameter");
    }
    const credentials = await options.getCredentials(request.scope);
    const url = new URL(`${graphOrigin}/${graphVersion}${safePath(request.path)}`);
    for (const [name, value] of Object.entries(request.query ?? {})) {
      if (value !== undefined) url.searchParams.set(name, String(value));
    }
    const proof = createHmac("sha256", credentials.appSecret).update(credentials.accessToken).digest("hex");
    let outboundBody: FormData | undefined;
    if (request.method === "GET") {
      url.searchParams.set("appsecret_proof", proof);
    } else {
      outboundBody = request.form ?? new FormData();
      if (outboundBody.has("access_token") || outboundBody.has("appsecret_proof")) throw new Error("Reserved Meta form parameter");
      if (request.body !== undefined) {
        if (request.body === null || typeof request.body !== "object" || Array.isArray(request.body)) throw new Error("Invalid Meta write body");
        for (const [name, value] of Object.entries(request.body)) {
          if (value !== undefined) outboundBody.append(name, formValue(value));
        }
      }
      outboundBody.append("appsecret_proof", proof);
    }

    await audit(request, "started");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await options.fetch(url, {
        method: request.method,
        headers: { authorization: `Bearer ${credentials.accessToken}` },
        ...(outboundBody === undefined ? {} : { body: outboundBody }),
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timer);
      const timedOut = controller.signal.aborted;
      const normalized = new MetaError(
        timedOut ? "Meta request timed out" : "Meta request failed",
        timedOut ? "timeout" : "network_error",
      );
      await audit(request, "failed", { errorCode: normalized.code });
      throw normalized;
    }

    const rate = rateEvidence(response.headers, now());
    const externalRequestId = safeHeader(response.headers.get("x-fb-request-id") ?? response.headers.get("x-fb-trace-id"));
    let body: unknown;
    try {
      body = await responseBody(response, controller.signal);
    } catch {
      const timedOut = controller.signal.aborted;
      const code = timedOut ? "timeout" : "invalid_response";
      await audit(request, "failed", {
        ...(externalRequestId === undefined ? {} : { externalRequestId }),
        errorCode: code,
        httpStatus: response.status,
      });
      throw new MetaError(timedOut ? "Meta request timed out" : "Meta upstream request failed", code, response.status);
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok || body === undefined) {
      const failure = body === undefined ? { code: "invalid_response", transient: false } : metaFailure(body);
      await audit(request, "failed", {
        ...(externalRequestId === undefined ? {} : { externalRequestId }),
        errorCode: failure.code,
        httpStatus: response.status,
        ...(rate.retryAfterSeconds === undefined ? {} : { retryAfter: String(rate.retryAfterSeconds) }),
      });
      throw new MetaError("Meta upstream request failed", failure.code, response.status, rate.retryAfterSeconds, failure.transient);
    }

    await audit(request, "succeeded", {
      ...(externalRequestId === undefined ? {} : { externalRequestId }),
      httpStatus: response.status,
    });
    return { data: body as T, rate };
  }

  async function request<T = unknown>(input: MetaRequest): Promise<{ data: T; rate: MetaRateEvidence }> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await once<T>(input);
      } catch (error) {
        const retryable =
          input.method === "GET" &&
          error instanceof MetaError &&
          (error.transient || error.status === 429 || error.status === 500 || error.status === 502 || error.status === 503 || error.status === 504 || error.status === undefined);
        if (!retryable || attempt + 1 >= maxAttempts) throw error;
        const delay = error.retryAfterSeconds === undefined
          ? Math.round(250 * 2 ** attempt * (1 + random()))
          : error.retryAfterSeconds * 1_000;
        await sleep(delay);
      }
    }
  }

  async function paginate<T>(input: MetaPageRequest): Promise<T[]> {
    const items: T[] = [];
    const cursors = new Set<string>();
    let after: string | undefined;
    for (let page = 0; page < maxPages; page += 1) {
      const response = await request<MetaEnvelope<T>>({
        ...input,
        method: "GET",
        query: { ...input.query, ...(after === undefined ? {} : { after }) },
      });
      if (!Array.isArray(response.data?.data)) throw new MetaError("Meta upstream request failed", "invalid_response", 502);
      items.push(...response.data.data);
      const next = response.data.paging?.cursors?.after;
      if (next === undefined) return items;
      if (typeof next !== "string" || next.length === 0 || next.length > 4_096) {
        throw new MetaError("Invalid Meta pagination cursor", "invalid_cursor", 502);
      }
      if (cursors.has(next)) throw new MetaError("Meta pagination repeated cursor", "repeated_cursor", 502);
      cursors.add(next);
      after = next;
    }
    throw new MetaError("Meta pagination page limit exceeded", "page_limit", 502);
  }

  async function runAsyncInsights<T>(input: AsyncInsightsRequest): Promise<T[]> {
    const created = await request<{ report_run_id?: unknown }>({
      ...input,
      method: "POST",
      body: { async: true },
    });
    const reportId = created.data?.report_run_id;
    if (typeof reportId !== "string" || !/^[A-Za-z0-9_.-]{1,255}$/.test(reportId)) {
      throw new MetaError("Meta Insights job response is invalid", "invalid_response", 502);
    }

    const { query: _query, ...jobContext } = input;
    let completed = false;
    for (let poll = 0; poll < maxPolls; poll += 1) {
      const status = await request<{ async_status?: unknown }>({ ...jobContext, method: "GET", path: `/${reportId}` });
      if (status.data.async_status === "Job Completed") {
        completed = true;
        break;
      }
      if (status.data.async_status === "Job Failed" || status.data.async_status === "Job Skipped") {
        throw new MetaError("Meta Insights job failed", "insights_job_failed", 502);
      }
      if (poll + 1 < maxPolls) await sleep(250);
    }
    if (!completed) throw new MetaError("Meta Insights poll limit exceeded", "poll_limit", 502);
    return paginate<T>({ ...jobContext, path: `/${reportId}/insights` });
  }

  return { request, paginate, runAsyncInsights };
}
