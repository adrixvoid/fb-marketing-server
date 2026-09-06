import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, realpath, rename, unlink } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { fileTypeFromBuffer } from "file-type";
import type { MultipartFile } from "@fastify/multipart";
import type { FastifyRequest } from "fastify";
import type { Context, HandlerMap } from "openapi-backend";
import type { ContractResponse } from "./contract.js";
import { appendAudit, transaction } from "./db.js";
import { resolveScope, type ResolvedScope } from "./scope.js";
import { requestId } from "./request-id.js";

const TWELVE_HOURS_MS = 12 * 60 * 60 * 1_000;
const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;
const allowedTypes = new Map([
  ["image/jpeg", { ext: "jpg", mediaType: "image" as const }],
  ["image/png", { ext: "png", mediaType: "image" as const }],
  ["video/mp4", { ext: "mp4", mediaType: "video" as const }],
]);
const pngBeforePalette = new Set(["cHRM", "gAMA", "iCCP", "sBIT", "sRGB"]);
const pngBeforeData = new Set(["bKGD", "hIST", "tRNS", "pHYs"]);
const pngEitherSideOfData = new Set(["sPLT", "eXIf", "tEXt", "zTXt", "iTXt", "tIME"]);

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
  removeFile?: (path: string) => Promise<void>;
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
    !/[/\\\p{Cc}\p{Cf}]/u.test(value.original_filename) &&
    allowedTypes.has(value.declared_content_type) &&
    (value.alt_text === undefined || value.alt_text.length <= 1000);
}

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function validJpeg(bytes: Buffer): boolean {
  if (!bytes.subarray(0, 2).equals(Buffer.from("ffd8", "hex"))) return false;
  let offset = 2;
  let frame = false;
  let scan = false;
  while (offset < bytes.length) {
    if (bytes[offset++] !== 0xff) return false;
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === 0xd9) return frame && scan && offset === bytes.length;
    if (marker === undefined || marker === 0x00 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) return false;
    if (offset + 2 > bytes.length) return false;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) return false;
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
      if (length < 11 || bytes.readUInt16BE(offset + 3) === 0 || bytes.readUInt16BE(offset + 5) === 0) return false;
      frame = true;
    }
    offset += length;
    if (marker !== 0xda) continue;
    scan = true;
    while (offset < bytes.length) {
      if (bytes[offset++] !== 0xff) continue;
      while (bytes[offset] === 0xff) offset += 1;
      const next = bytes[offset++];
      if (next === 0x00 || (next !== undefined && next >= 0xd0 && next <= 0xd7)) continue;
      if (next === 0xd9) return frame && offset === bytes.length;
      return false;
    }
  }
  return false;
}

function validPng(bytes: Buffer): boolean {
  if (!bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) return false;
  let offset = 8;
  let colorType: number | undefined;
  let palette = false;
  let data = false;
  let dataEnded = false;
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) return false;
    const length = bytes.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > bytes.length) return false;
    const type = bytes.subarray(offset + 4, offset + 8).toString("ascii");
    if (!/^[A-Za-z]{2}[A-Z][A-Za-z]$/.test(type)) return false;
    if (bytes.readUInt32BE(offset + 8 + length) !== crc32(bytes.subarray(offset + 4, offset + 8 + length))) return false;

    if (type === "IHDR") {
      if (offset !== 8 || length !== 13 || bytes.readUInt32BE(offset + 8) === 0 || bytes.readUInt32BE(offset + 12) === 0) return false;
      const bitDepth = bytes[offset + 16]!;
      colorType = bytes[offset + 17]!;
      const depths: Record<number, number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
      if (!depths[colorType]?.includes(bitDepth) || bytes[offset + 18] !== 0 || bytes[offset + 19] !== 0 || ![0, 1].includes(bytes[offset + 20]!)) return false;
    } else if (type === "PLTE") {
      if (colorType === undefined || palette || data || [0, 4].includes(colorType) || length === 0 || length % 3 !== 0 || length > 768) return false;
      palette = true;
    } else if (type === "IDAT") {
      if (colorType === undefined || dataEnded || (colorType === 3 && !palette)) return false;
      data = true;
    } else if (type === "IEND") {
      return length === 0 && data && end === bytes.length;
    } else {
      if (colorType === undefined || (type.charCodeAt(0) & 32) === 0) return false;
      if (
        pngBeforePalette.has(type) ? palette || data :
        pngBeforeData.has(type) ? data :
        !pngEitherSideOfData.has(type)
      ) return false;
      if (data) dataEnded = true;
    }
    offset = end;
  }
  return false;
}

function structurallyValid(contentType: string, bytes: Buffer): boolean {
  if (/<(?:!doctype|html|script|iframe|svg)(?:\s|>)/i.test(bytes.toString("latin1"))) return false;
  if (contentType === "image/png") return validPng(bytes);
  if (contentType === "image/jpeg") return validJpeg(bytes);
  if (contentType === "video/mp4") {
    let offset = 0;
    let first = true;
    let hasMediaData = false;
    let hasMetadata = false;
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
      if (type === "moov") hasMetadata = true;
      offset += size;
      first = false;
    }
    return offset === bytes.length && hasMediaData && hasMetadata;
  }
  return false;
}

async function privateRoot(path: string, dataRoot: string) {
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
  const entry = await lstat(target);
  return { dev: entry.dev, ino: entry.ino, path: await realpath(target) };
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
  removeFile = unlink,
}: MediaOptions) {
  const rootIdentity = await privateRoot(mediaRoot, dataRoot);

  async function assertMediaRoot(): Promise<void> {
    const entry = await lstat(mediaRoot);
    if (
      entry.isSymbolicLink() || !entry.isDirectory() || entry.dev !== rootIdentity.dev || entry.ino !== rootIdentity.ino ||
      await realpath(mediaRoot) !== rootIdentity.path || (entry.mode & 0o077) !== 0 ||
      (process.getuid !== undefined && entry.uid !== process.getuid())
    ) throw new Error("Media root changed or is unsafe");
  }

  async function safeRemove(name: string): Promise<void> {
    if (name.length < 1 || name.length > 255 || name === "." || name === ".." || /[/\\\0]/.test(name)) throw new Error("Media storage name is unsafe");
    await assertMediaRoot();
    const path = join(mediaRoot, name);
    try {
      const entry = await lstat(path);
      if (!entry.isSymbolicLink() && (!entry.isFile() || (process.getuid !== undefined && entry.uid !== process.getuid()))) throw new Error("Media file is unsafe");
      await removeFile(path);
      await assertMediaRoot();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  async function cleanupUnreferenced(): Promise<void> {
    await assertMediaRoot();
    const names = new Set(db.prepare("SELECT storage_name FROM staged_media").all().map(({ storage_name }) => String(storage_name)));
    const terminal = new Set(db.prepare("SELECT storage_name FROM staged_media WHERE status IN ('consumed', 'expired', 'invalid')").all().map(({ storage_name }) => String(storage_name)));
    for (const name of await readdir(mediaRoot)) {
      if (!names.has(name) || terminal.has(name)) await safeRemove(name);
    }
    await assertMediaRoot();
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
    if (!validMetadata(input.attachment) || input.declaredFileType !== input.attachment.declared_content_type) {
      throw new MediaError("Attachment metadata is invalid", 422, "media_invalid");
    }
    let scope: ResolvedScope;
    try {
      scope = resolveScope(db, { clientId: input.clientId, adAccountId: input.adAccountId }, { task: "ADVERTISE", permission: "ads_management" });
    } catch {
      throw new MediaError("Scope is not authorized", 409, "client_account_mismatch");
    }
    await assertMediaRoot();
    const temporaryName = randomUUID();
    const temporaryPath = join(mediaRoot, temporaryName);
    const handle = await open(temporaryPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    try {
      await assertMediaRoot();
      const opened = await handle.stat();
      if (!opened.isFile() || (opened.mode & 0o077) !== 0 || (process.getuid !== undefined && opened.uid !== process.getuid())) throw new Error("Media file is unsafe");
    } catch (error) {
      await handle.close();
      throw error;
    }
    const digest = createHash("sha256");
    const chunks: Buffer[] = [];
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
        chunks.push(chunk);
        await handle.write(chunk);
      }
      if (size === 0) throw new MediaError("Attachment is empty", 422, "media_invalid");
    } catch (error) {
      (input.bytes as AsyncIterable<Uint8Array> & { destroy?: () => void }).destroy?.();
      void iterator.return?.();
      streamError = error;
    } finally {
      await handle.close();
    }
    if (streamError !== undefined) {
      await safeRemove(temporaryName);
      throw streamError;
    }

    try {
      const bytes = Buffer.concat(chunks, size);
      const detected = await fileTypeFromBuffer(bytes);
      const accepted = detected === undefined ? undefined : allowedTypes.get(detected.mime);
      if (
        accepted === undefined ||
        accepted.ext !== detected!.ext ||
        detected!.mime !== input.declaredFileType ||
        !structurallyValid(detected!.mime, bytes)
      ) {
        throw new MediaError("Attachment content is invalid", 422, "media_invalid");
      }

      const createdAt = now();
      const expiresAt = new Date(createdAt.getTime() + TWELVE_HOURS_MS);
      const mediaId = randomUUID();
      const storageName = randomUUID();
      const finalPath = join(mediaRoot, storageName);
      const sha256 = digest.digest("hex");
      await assertMediaRoot();
      await rename(temporaryPath, finalPath);
      await assertMediaRoot();
      const finalEntry = await lstat(finalPath);
      if (finalEntry.isSymbolicLink() || !finalEntry.isFile() || (finalEntry.mode & 0o077) !== 0) {
        await safeRemove(storageName);
        throw new Error("Published media is unsafe");
      }
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
        await safeRemove(storageName);
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
      await safeRemove(temporaryName);
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
    transaction(db, () => {
      for (const row of rows) db.prepare("UPDATE staged_media SET status = 'expired' WHERE id = ? AND status IN ('staged', 'bound')").run(String(row.id));
    });
    for (const row of rows) {
      await safeRemove(String(row.storage_name));
    }
    return rows.length;
  }

  async function cleanupOperation(operationId: string, status: "consumed" | "expired" | "invalid"): Promise<number> {
    const rows = db.prepare(`SELECT m.id, m.storage_name FROM operation_media om
      JOIN staged_media m ON m.id = om.media_id
      WHERE om.operation_id = ? AND m.status = 'bound'`).all(operationId);
    transaction(db, () => {
      for (const row of rows) db.prepare("UPDATE staged_media SET status = ? WHERE id = ? AND status = 'bound'").run(status, String(row.id));
    });
    for (const row of rows) await safeRemove(String(row.storage_name));
    return rows.length;
  }

  async function hashFile(storageName: string): Promise<string> {
    await assertMediaRoot();
    const handle = await open(join(mediaRoot, storageName), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      await assertMediaRoot();
      const entry = await handle.stat();
      if (!entry.isFile() || (entry.mode & 0o077) !== 0 || (process.getuid !== undefined && entry.uid !== process.getuid())) throw new Error("Media file is unsafe");
      const digest = createHash("sha256");
      const buffer = Buffer.allocUnsafe(64 * 1024);
      let position = 0;
      while (true) {
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
        if (bytesRead === 0) break;
        digest.update(buffer.subarray(0, bytesRead));
        position += bytesRead;
      }
      await assertMediaRoot();
      return digest.digest("hex");
    } finally {
      await handle.close();
    }
  }

  async function readBound(input: { operationId: string; mediaId: string; sha256: string }) {
    const row = db.prepare(`SELECT m.storage_name, m.content_type FROM operation_media om
      JOIN staged_media m ON m.id = om.media_id
      WHERE om.operation_id = ? AND om.media_id = ? AND om.media_hash = ?
        AND m.sha256 = ? AND m.status = 'bound'`)
      .get(input.operationId, input.mediaId, input.sha256, input.sha256) as { storage_name: string; content_type: string } | undefined;
    if (row === undefined) throw new MediaError("Operation media is invalid", 422, "media_invalid");
    await assertMediaRoot();
    const handle = await open(join(mediaRoot, row.storage_name), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      await assertMediaRoot();
      const entry = await handle.stat();
      if (!entry.isFile() || entry.size < 1 || entry.size > maxBytes || (entry.mode & 0o077) !== 0 || (process.getuid !== undefined && entry.uid !== process.getuid())) {
        throw new MediaError("Operation media is unsafe", 422, "media_invalid");
      }
      const bytes = await handle.readFile();
      await assertMediaRoot();
      if (createHash("sha256").update(bytes).digest("hex") !== input.sha256) throw new MediaError("Operation media hash is invalid", 422, "media_invalid");
      return { contentType: row.content_type as "image/jpeg" | "image/png" | "video/mp4", bytes };
    } finally {
      await handle.close();
    }
  }

  return { stage, cleanupExpired, cleanupOperation, hashFile, readBound, auditFailure };
}

type MediaService = Awaited<ReturnType<typeof createMediaService>>;

function mediaProblem(id: string, error: MediaError): ContractResponse {
  return {
    statusCode: error.status,
    mediaType: "application/problem+json",
    headers: { "x-request-id": id },
    body: {
      type: `urn:fb-marketing-server:${error.code}`,
      title: error.status === 413 ? "Payload too large" : error.status === 409 ? "Conflict" : "Unprocessable media",
      status: error.status,
      code: error.code,
      detail: error.message,
      request_id: id,
    },
  };
}

export function createMediaHandlers(service: MediaService, actor: string): HandlerMap {
  return {
    stageMedia: async (context: Context, rawRequest: FastifyRequest) => {
      const id = requestId(context.request.headers["x-request-id"]);
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
        const chunks: Buffer[] = [];
        const iterator = file.file[Symbol.asyncIterator]();
        const deadline = Date.now() + DEFAULT_TIMEOUT_MS;
        try {
          while (true) {
            const remaining = deadline - Date.now();
            if (remaining <= 0) throw new MediaError("Media upload timed out", 422, "media_invalid");
            const part = await nextWithDeadline(iterator.next(), abort.signal, remaining);
            if (part.done) break;
            chunks.push(Buffer.from(part.value));
          }
        } catch (error) {
          file.file.destroy();
          void iterator.return?.();
          throw error;
        }
        if (file.file.truncated) throw new MediaError("Attachment is too large", 413, "media_too_large");
        while (true) {
          const extra = await parts.next();
          if (extra.done) break;
          if (extra.value.type === "file") {
            extra.value.file.destroy();
            throw new MediaError("Multipart contains extra parts", 422, "media_invalid");
          }
          addField(extra.value);
        }
        const attachmentValue = fields.get("attachment");
        const attachment = typeof attachmentValue === "string" ? JSON.parse(attachmentValue) as unknown : attachmentValue;
        clientId = typeof fields.get("client_id") === "string" ? fields.get("client_id") as string : undefined;
        adAccountId = typeof fields.get("ad_account_id") === "string" ? fields.get("ad_account_id") as string : undefined;
        if (!clientId || !adAccountId || attachment === null || typeof attachment !== "object" || Array.isArray(attachment)) {
          throw new MediaError("Multipart fields are invalid", 422, "media_invalid");
        }
        const metadata = attachment as AttachmentMetadata;
        if (file.filename !== metadata.original_filename) throw new MediaError("Attachment filename does not match metadata", 422, "media_invalid");
        const stageInput: StageMediaInput = {
          actor,
          requestId: id,
          clientId,
          adAccountId,
          attachment: metadata,
          declaredFileType: file.mimetype,
          bytes: (async function* () { for (const chunk of chunks) yield chunk; })(),
          signal: abort.signal,
        };
        stageStarted = true;
        const result = await service.stage(stageInput);
        return {
          statusCode: 201,
          mediaType: "application/json",
          headers: { "x-request-id": id },
          body: { request_id: id, ...result },
        } satisfies ContractResponse;
      } catch (error) {
        const normalized = error instanceof MediaError
          ? error
          : new MediaError("Multipart attachment is invalid", 422, "media_invalid");
        if (!stageStarted) {
          service.auditFailure({ actor, requestId: id, ...(clientId ? { clientId } : {}), ...(adAccountId ? { adAccountId } : {}) }, normalized.code);
        }
        return mediaProblem(id, normalized);
      }
    },
  };
}
