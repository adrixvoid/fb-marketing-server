import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, lstat, mkdir, open, readFile, readdir, rename, rm } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { fileTypeFromFile } from "file-type";
import type { MultipartFile } from "@fastify/multipart";
import type { FastifyRequest } from "fastify";
import type { Context, HandlerMap } from "openapi-backend";
import type { ContractResponse } from "./contract.js";
import { appendAudit, transaction } from "./db.js";
import { resolveScope, type ResolvedScope } from "./scope.js";

const TWELVE_HOURS_MS = 12 * 60 * 60 * 1_000;
const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;
const allowedTypes = new Map([
  ["image/jpeg", { ext: "jpg", mediaType: "image" as const }],
  ["image/png", { ext: "png", mediaType: "image" as const }],
  ["video/mp4", { ext: "mp4", mediaType: "video" as const }],
]);

export class MediaError extends Error {
  constructor(message: string, readonly status: 409 | 413 | 422, readonly code: "client_account_mismatch" | "media_too_large" | "media_invalid") {
    super(message);
  }
}

export interface AttachmentMetadata {
  source: "openclaw_chat_attachment";
  attachment_id: string;
  original_filename: string;
  declared_content_type: "image/jpeg" | "image/png" | "video/mp4";
  alt_text?: string;
}

export interface StageMediaInput {
  actor: string;
  requestId: string;
  clientId: string;
  adAccountId: string;
  attachment: AttachmentMetadata;
  declaredFileType: string;
  bytes: AsyncIterable<Uint8Array>;
  signal?: AbortSignal;
}

interface MediaOptions {
  db: DatabaseSync;
  dataRoot: string;
  mediaRoot: string;
  now?: () => Date;
  maxBytes?: number;
  timeoutMs?: number;
}

function publicScope(scope: ResolvedScope) {
  return {
    client_id: scope.clientId,
    client_name: scope.clientName,
    ad_account_id: scope.adAccountId,
    ad_account_name: scope.adAccountName,
    ...(scope.currency === undefined ? {} : { currency: scope.currency }),
    ...(scope.timezone === undefined ? {} : { timezone: scope.timezone }),
  };
}

function validMetadata(value: AttachmentMetadata): boolean {
  return value.source === "openclaw_chat_attachment" &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/.test(value.attachment_id) &&
    value.original_filename.length >= 1 && value.original_filename.length <= 255 &&
    !/[/\\\u0000-\u001f\u007f]/.test(value.original_filename) &&
    allowedTypes.has(value.declared_content_type) &&
    (value.alt_text === undefined || value.alt_text.length <= 1000);
}

function structurallyValid(contentType: string, bytes: Buffer): boolean {
  if (/<(?:!doctype|html|script|iframe|svg)(?:\s|>)/i.test(bytes.toString("latin1"))) return false;
  if (contentType === "image/png") {
    return bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")) &&
      bytes.subarray(-12).equals(Buffer.from("0000000049454e44ae426082", "hex"));
  }
  if (contentType === "image/jpeg") return bytes.subarray(0, 2).equals(Buffer.from("ffd8", "hex")) && bytes.subarray(-2).equals(Buffer.from("ffd9", "hex"));
  if (contentType === "video/mp4") {
    let offset = 0;
    let first = true;
    let hasMediaData = false;
    while (offset < bytes.length) {
      if (bytes.length - offset < 8) return false;
      let size = bytes.readUInt32BE(offset);
      const type = bytes.subarray(offset + 4, offset + 8).toString("ascii");
      let header = 8;
      if (size === 1) {
        if (bytes.length - offset < 16) return false;
        const extended = bytes.readBigUInt64BE(offset + 8);
        if (extended > BigInt(Number.MAX_SAFE_INTEGER)) return false;
        size = Number(extended);
        header = 16;
      } else if (size === 0) {
        size = bytes.length - offset;
      }
      if (size < header || offset + size > bytes.length || (first && type !== "ftyp")) return false;
      if (type === "mdat") hasMediaData = true;
      offset += size;
      first = false;
    }
    return offset === bytes.length && hasMediaData;
  }
  return false;
}

async function privateRoot(path: string, dataRoot: string): Promise<void> {
  const root = resolve(dataRoot);
  const target = resolve(path);
  const distance = relative(root, target);
  if (distance === "" || distance === ".." || distance.startsWith(`..${sep}`)) throw new Error("Media root is unsafe");
  const segments = distance.split(sep);
  let current = root;
  for (const segment of ["", ...segments]) {
    if (segment) current = join(current, segment);
    let entry;
    try {
      entry = await lstat(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" || !segment) throw error;
      await mkdir(current, { mode: 0o700 });
      entry = await lstat(current);
    }
    if (entry.isSymbolicLink() || !entry.isDirectory() || (entry.mode & 0o077) !== 0 || (process.getuid !== undefined && entry.uid !== process.getuid())) {
      throw new Error("Media root is unsafe or contains a symlink");
    }
  }
}

async function nextWithDeadline<T>(
  next: Promise<IteratorResult<T>>,
  signal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<IteratorResult<T>> {
  if (signal?.aborted) throw new MediaError("Media upload was aborted", 422, "media_invalid");
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new MediaError("Media upload timed out", 422, "media_invalid")), timeoutMs);
    const abort = () => reject(new MediaError("Media upload was aborted", 422, "media_invalid"));
    signal?.addEventListener("abort", abort, { once: true });
    next.then(resolve, reject).finally(() => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    });
  });
}

export async function createMediaService({
  db,
  dataRoot,
  mediaRoot,
  now = () => new Date(),
  maxBytes = DEFAULT_MAX_BYTES,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: MediaOptions) {
  await privateRoot(mediaRoot, dataRoot);

  async function cleanupUnreferenced(): Promise<void> {
    const names = new Set(db.prepare("SELECT storage_name FROM staged_media").all().map(({ storage_name }) => String(storage_name)));
    for (const name of await readdir(mediaRoot)) {
      if (!names.has(name)) await rm(join(mediaRoot, name), { force: true });
    }
  }
  await cleanupUnreferenced();

  function auditFailure(input: { actor: string; requestId: string; clientId?: string; adAccountId?: string }, code = "media_invalid") {
    let scope: ResolvedScope | undefined;
    try {
      scope = input.clientId && input.adAccountId
        ? resolveScope(db, { clientId: input.clientId, adAccountId: input.adAccountId })
        : undefined;
    } catch {
      scope = undefined;
    }
    appendAudit(db, {
      actor: input.actor,
      ...(scope === undefined ? {} : { clientId: scope.clientId, adAccountId: scope.adAccountId, generationId: scope.generationId }),
      operation: "stage_media",
      correlationId: input.requestId,
      occurredAt: now().toISOString(),
      outcome: "failed",
      evidence: { errorCode: code },
    });
  }

  async function stageInternal(input: StageMediaInput) {
    const temporaryName = randomUUID();
    const temporaryPath = join(mediaRoot, temporaryName);
    const handle = await open(temporaryPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
    const digest = createHash("sha256");
    const iterator = input.bytes[Symbol.asyncIterator]();
    const deadline = Date.now() + timeoutMs;
    let size = 0;
    let streamError: unknown;
    try {
      while (true) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new MediaError("Media upload timed out", 422, "media_invalid");
        const part = await nextWithDeadline(iterator.next(), input.signal, remaining);
        if (part.done) break;
        const chunk = Buffer.from(part.value);
        size += chunk.length;
        if (size > maxBytes) throw new MediaError("Attachment is too large", 413, "media_too_large");
        digest.update(chunk);
        await handle.write(chunk);
      }
      if (size === 0) throw new MediaError("Attachment is empty", 422, "media_invalid");
    } catch (error) {
      void iterator.return?.();
      streamError = error;
    } finally {
      await handle.close();
    }
    if (streamError !== undefined) {
      await rm(temporaryPath, { force: true });
      throw streamError;
    }

    try {
      if (!validMetadata(input.attachment) || input.declaredFileType !== input.attachment.declared_content_type) {
        throw new MediaError("Attachment metadata is invalid", 422, "media_invalid");
      }
      const detected = await fileTypeFromFile(temporaryPath);
      const accepted = detected === undefined ? undefined : allowedTypes.get(detected.mime);
      const bytes = await readFile(temporaryPath);
      if (
        accepted === undefined ||
        accepted.ext !== detected!.ext ||
        detected!.mime !== input.declaredFileType ||
        !structurallyValid(detected!.mime, bytes)
      ) {
        throw new MediaError("Attachment content is invalid", 422, "media_invalid");
      }

      let scope: ResolvedScope;
      try {
        scope = resolveScope(db, { clientId: input.clientId, adAccountId: input.adAccountId }, { task: "ADVERTISE", permission: "ads_management" });
      } catch {
        throw new MediaError("Scope is not authorized", 409, "client_account_mismatch");
      }
      const createdAt = now();
      const expiresAt = new Date(createdAt.getTime() + TWELVE_HOURS_MS);
      const mediaId = randomUUID();
      const storageName = randomUUID();
      const finalPath = join(mediaRoot, storageName);
      const sha256 = digest.digest("hex");
      await rename(temporaryPath, finalPath);
      try {
        transaction(db, () => {
          db.prepare(`
            INSERT INTO staged_media
              (id, client_id, ad_account_id, generation_id, sha256, media_type, content_type,
               size_bytes, original_filename, attachment_id, alt_text, actor, correlation_id,
               storage_name, status, created_at, expires_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'staged', ?, ?)
          `).run(
            mediaId, scope.clientId, scope.adAccountId, scope.generationId, sha256, accepted.mediaType,
            detected!.mime, size, input.attachment.original_filename, input.attachment.attachment_id,
            input.attachment.alt_text ?? null, input.actor, input.requestId, storageName,
            createdAt.toISOString(), expiresAt.toISOString(),
          );
          appendAudit(db, {
            actor: input.actor,
            clientId: scope.clientId,
            adAccountId: scope.adAccountId,
            generationId: scope.generationId,
            operation: "stage_media",
            correlationId: input.requestId,
            occurredAt: createdAt.toISOString(),
            outcome: "succeeded",
          });
        });
      } catch (error) {
        await rm(finalPath, { force: true });
        throw error;
      }
      return {
        scope: publicScope(scope),
        media: {
          media_id: mediaId,
          sha256,
          status: "staged" as const,
          media_type: accepted.mediaType,
          content_type: detected!.mime as "image/jpeg" | "image/png" | "video/mp4",
          size_bytes: size,
          created_at: createdAt.toISOString(),
          expires_at: expiresAt.toISOString(),
          operation_id: null,
        },
      };
    } finally {
      await rm(temporaryPath, { force: true });
    }
  }

  async function stage(input: StageMediaInput) {
    try {
      return await stageInternal(input);
    } catch (error) {
      auditFailure(input, error instanceof MediaError ? error.code : "media_invalid");
      throw error;
    }
  }

  async function cleanupExpired(at = now()): Promise<number> {
    const rows = db.prepare("SELECT id, storage_name FROM staged_media WHERE status IN ('staged', 'bound') AND expires_at <= ?").all(at.toISOString());
    for (const row of rows) {
      await rm(join(mediaRoot, String(row.storage_name)), { force: true });
      db.prepare("UPDATE staged_media SET status = 'expired' WHERE id = ? AND status IN ('staged', 'bound')").run(String(row.id));
    }
    return rows.length;
  }

  async function cleanupOperation(operationId: string, status: "consumed" | "expired" | "invalid"): Promise<number> {
    const rows = db.prepare(`SELECT m.id, m.storage_name FROM operation_media om
      JOIN staged_media m ON m.id = om.media_id
      WHERE om.operation_id = ? AND m.status = 'bound'`).all(operationId);
    for (const row of rows) await rm(join(mediaRoot, String(row.storage_name)), { force: true });
    transaction(db, () => {
      for (const row of rows) db.prepare("UPDATE staged_media SET status = ? WHERE id = ? AND status = 'bound'").run(status, String(row.id));
    });
    return rows.length;
  }

  return { stage, cleanupExpired, cleanupOperation, auditFailure };
}

type MediaService = Awaited<ReturnType<typeof createMediaService>>;

function mediaProblem(context: Context, error: MediaError): ContractResponse {
  const requestId = requestIdFrom(context);
  return {
    statusCode: error.status,
    mediaType: "application/problem+json",
    headers: { "x-request-id": requestId },
    body: {
      type: `urn:fb-marketing-server:${error.code}`,
      title: error.status === 413 ? "Payload too large" : error.status === 409 ? "Conflict" : "Unprocessable media",
      status: error.status,
      code: error.code,
      detail: error.message,
      request_id: requestId,
    },
  };
}

function requestIdFrom(context: Context): string {
  const value = context.request.headers["x-request-id"];
  return typeof value === "string" && /^[A-Za-z0-9._:-]{8,128}$/.test(value) ? value : randomUUID();
}

export function createMediaHandlers(service: MediaService, actor: string): HandlerMap {
  return {
    stageMedia: async (context: Context, rawRequest: FastifyRequest) => {
      const requestId = requestIdFrom(context);
      let clientId: string | undefined;
      let adAccountId: string | undefined;
      let stageStarted = false;
      try {
        if (!rawRequest.isMultipart()) throw new MediaError("Trusted multipart attachment is required", 422, "media_invalid");
        const parts = rawRequest.parts({ limits: { files: 1, fields: 3, parts: 4, fileSize: DEFAULT_MAX_BYTES } })[Symbol.asyncIterator]();
        const fields = new Map<string, unknown>();
        const addField = (part: { fieldname: string; value: unknown }) => {
          if (!["client_id", "ad_account_id", "attachment"].includes(part.fieldname) || fields.has(part.fieldname)) {
            throw new MediaError("Multipart fields are invalid", 422, "media_invalid");
          }
          fields.set(part.fieldname, part.value);
        };
        let file: MultipartFile | undefined;
        while (file === undefined) {
          const part = await parts.next();
          if (part.done) break;
          if (part.value.type === "file") {
            file = part.value;
            break;
          }
          addField(part.value);
        }
        if (file?.type !== "file" || file.fieldname !== "file") {
          throw new MediaError("Multipart fields are invalid", 422, "media_invalid");
        }
        const abort = new AbortController();
        rawRequest.raw.once("aborted", () => abort.abort());
        const stageInput: StageMediaInput = {
          actor,
          requestId,
          clientId: "",
          adAccountId: "",
          attachment: {} as AttachmentMetadata,
          declaredFileType: file.mimetype,
          bytes: undefined as never,
          signal: abort.signal,
        };
        const applyFields = () => {
          clientId = typeof fields.get("client_id") === "string" ? fields.get("client_id") as string : undefined;
          adAccountId = typeof fields.get("ad_account_id") === "string" ? fields.get("ad_account_id") as string : undefined;
          const attachmentValue = fields.get("attachment");
          const attachment = typeof attachmentValue === "string" ? JSON.parse(attachmentValue) as unknown : attachmentValue;
          if (!clientId || !adAccountId || attachment === null || typeof attachment !== "object" || Array.isArray(attachment)) {
            throw new MediaError("Multipart fields are invalid", 422, "media_invalid");
          }
          const metadata = attachment as AttachmentMetadata;
          if (file.filename !== metadata.original_filename) throw new MediaError("Attachment filename does not match metadata", 422, "media_invalid");
          stageInput.clientId = clientId;
          stageInput.adAccountId = adAccountId;
          stageInput.attachment = metadata;
        };
        const bytes = (async function* () {
          for await (const chunk of file.file) yield chunk;
          if (file.file.truncated) throw new MediaError("Attachment is too large", 413, "media_too_large");
          while (true) {
            const extra = await parts.next();
            if (extra.done) break;
            if (extra.value.type === "file") {
              extra.value.file.resume();
              throw new MediaError("Multipart contains extra parts", 422, "media_invalid");
            }
            addField(extra.value);
          }
          applyFields();
        })();
        stageInput.bytes = bytes;
        stageStarted = true;
        const result = await service.stage(stageInput);
        return {
          statusCode: 201,
          mediaType: "application/json",
          headers: { "x-request-id": requestId },
          body: { request_id: requestId, ...result },
        } satisfies ContractResponse;
      } catch (error) {
        const normalized = error instanceof MediaError
          ? error
          : new MediaError("Multipart attachment is invalid", 422, "media_invalid");
        if (!stageStarted) {
          service.auditFailure({ actor, requestId, ...(clientId ? { clientId } : {}), ...(adAccountId ? { adAccountId } : {}) }, normalized.code);
        }
        return mediaProblem(context, normalized);
      }
    },
  };
}
