import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test, { type TestContext } from "node:test";
import { buildApp } from "../src/app.js";
import { openDatabase } from "../src/db.js";
import { createMediaHandlers, createMediaService, MediaError } from "../src/media.js";

const now = new Date("2026-08-19T12:00:00.000Z");
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const jpeg = Buffer.from("ffd8ffc0000b080001000101011100ffda0008010100003f0000ffd9", "hex");
const mp4 = Buffer.from("000000186674797069736f6d0000020069736f6d69736f32000000086d6f6f760000000c6d64617400000000", "hex");

function pngCrc(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array = Buffer.alloc(0)): Buffer {
  const typed = Buffer.concat([Buffer.from(type), data]);
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length);
  typed.copy(chunk, 4);
  chunk.writeUInt32BE(pngCrc(typed), 8 + data.length);
  return chunk;
}

function pngParts(bytes: Buffer): Buffer[] {
  const parts = [bytes.subarray(0, 8)];
  for (let offset = 8; offset < bytes.length;) {
    const end = offset + 12 + bytes.readUInt32BE(offset);
    parts.push(bytes.subarray(offset, end));
    offset = end;
  }
  return parts;
}

function seed(db: ReturnType<typeof openDatabase>) {
  db.exec(`
    INSERT INTO clients (id, name, portfolio_id) VALUES ('client-1', 'Client One', 'portfolio-1');
    INSERT INTO integrations (id, name, meta_app_id, state) VALUES ('integration-1', 'App', 'app-1', 'active');
    INSERT INTO integration_generations (id, integration_id, generation, status, validated_at)
      VALUES ('generation-1', 'integration-1', '2026-08', 'active', '${now.toISOString()}');
    INSERT INTO ad_accounts (id, client_id, name, currency, timezone)
      VALUES ('act_1', 'client-1', 'Account One', 'USD', 'America/New_York');
    INSERT INTO scope_mappings
      (client_id, ad_account_id, generation_id, active, app_authorized, subject_authorized, partner_authorized, asset_authorized, granted_tasks)
      VALUES ('client-1', 'act_1', 'generation-1', 1, 1, 1, 1, 1, '["ADVERTISE"]');
    INSERT INTO encrypted_credentials
      (id, generation_id, subject_id, key_ref, envelope_version, ciphertext, iv, auth_tag, scopes, status, validated_at)
      VALUES ('credential-1', 'generation-1', 'subject-1', 'key', 1, 'cipher', 'iv', 'tag', '["ads_management"]', 'active', '${now.toISOString()}');
  `);
}

async function fixture(t: TestContext, options: { maxBytes?: number; timeoutMs?: number } = {}) {
  const root = await mkdtemp(join(tmpdir(), "fb-marketing-server-media-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const db = openDatabase(":memory:");
  t.after(() => db.close());
  seed(db);
  const mediaRoot = join(root, "media");
  const service = await createMediaService({ db, dataRoot: root, mediaRoot, now: () => now, ...options });
  return { root, mediaRoot, db, service };
}

function input(bytes: Buffer, overrides: Record<string, unknown> = {}) {
  return {
    actor: "openclaw:user-1",
    requestId: "request-media-1",
    clientId: "client-1",
    adAccountId: "act_1",
    attachment: {
      source: "openclaw_chat_attachment" as const,
      attachment_id: "attachment-1",
      original_filename: "creative.png",
      declared_content_type: "image/png" as const,
    },
    declaredFileType: "image/png",
    bytes: (async function* () { yield bytes; })(),
    ...overrides,
  };
}

test("stages a trusted attachment privately and binds its hash to the resolved scope", async (t) => {
  const { root, db, service } = await fixture(t);

  const result = await service.stage({
    actor: "openclaw:user-1",
    requestId: "request-media-1",
    clientId: "client-1",
    adAccountId: "act_1",
    attachment: {
      source: "openclaw_chat_attachment",
      attachment_id: "attachment-1",
      original_filename: "pixel.png",
      declared_content_type: "image/png",
      alt_text: "A pixel",
    },
    declaredFileType: "image/png",
    bytes: (async function* () { yield png; })(),
  });

  assert.equal(result.scope.client_id, "client-1");
  assert.equal(result.media.content_type, "image/png");
  assert.equal(result.media.size_bytes, png.length);
  assert.match(result.media.sha256, /^[a-f0-9]{64}$/);
  assert.equal(result.media.expires_at, "2026-08-20T00:00:00.000Z");
  const row = db.prepare("SELECT storage_name, sha256, status FROM staged_media WHERE id = ?").get(result.media.media_id)!;
  assert.equal(row.sha256, result.media.sha256);
  assert.equal(row.status, "staged");
  assert.doesNotMatch(String(row.storage_name), /pixel\.png|[/\\]/);
  const storedPath = join(root, "media", String(row.storage_name));
  assert.deepEqual(await readFile(storedPath), png);
  assert.equal((await stat(join(root, "media"))).mode & 0o777, 0o700);
  assert.equal((await stat(storedPath)).mode & 0o777, 0o600);
});

test("reads only the exact hash-bound media bytes for an executing operation", async (t) => {
  const { db, service } = await fixture(t);
  const staged = await service.stage(input(png));
  db.prepare(`INSERT INTO operations
    (id, actor, client_id, ad_account_id, generation_id, operation_type, payload_json, payload_hash,
     status, created_at, expires_at)
    VALUES ('operation-read', 'openclaw', 'client-1', 'act_1', 'generation-1', 'create_campaign_bundle', '{}', ?,
      'pending', ?, ?)`)
    .run("0".repeat(64), now.toISOString(), "2026-08-20T00:00:00.000Z");
  db.prepare("INSERT INTO operation_media (operation_id, media_id, media_hash, client_id, ad_account_id) VALUES ('operation-read', ?, ?, 'client-1', 'act_1')")
    .run(staged.media.media_id, staged.media.sha256);
  db.prepare("UPDATE staged_media SET status = 'bound' WHERE id = ?").run(staged.media.media_id);

  const resolved = await service.readBound({ operationId: "operation-read", mediaId: staged.media.media_id, sha256: staged.media.sha256 });

  assert.equal(resolved.contentType, "image/png");
  assert.deepEqual(resolved.bytes, png);
  await assert.rejects(
    service.readBound({ operationId: "operation-read", mediaId: staged.media.media_id, sha256: "f".repeat(64) }),
    /media/i,
  );
});

test("accepts only structurally complete JPEG, PNG, and MP4 bytes matching both MIME declarations", async (t) => {
  const { service } = await fixture(t);
  const [signature, ihdr, idat, iend] = pngParts(png);
  const indexedHeader = Buffer.from(ihdr!.subarray(8, -4));
  indexedHeader[8] = 8;
  indexedHeader[9] = 3;
  const compressed = idat!.subarray(8, -4);
  const structuredPng = Buffer.concat([
    signature!, pngChunk("IHDR", indexedHeader), pngChunk("PLTE", Buffer.from([0, 0, 0])),
    pngChunk("IDAT", compressed.subarray(0, 5)), pngChunk("IDAT", compressed.subarray(5)),
    pngChunk("tEXt", Buffer.from("k\0v")), iend!,
  ]);
  for (const [bytes, contentType, filename] of [
    [jpeg, "image/jpeg", "creative.jpg"],
    [png, "image/png", "creative.png"],
    [structuredPng, "image/png", "structured.png"],
    [mp4, "video/mp4", "creative.mp4"],
  ] as const) {
    const result = await service.stage(input(bytes, {
      requestId: `request-${contentType}`,
      declaredFileType: contentType,
      attachment: {
        source: "openclaw_chat_attachment",
        attachment_id: `attachment-${contentType.replace("/", "-")}`,
        original_filename: filename,
        declared_content_type: contentType,
      },
    }));
    assert.equal(result.media.content_type, contentType);
    assert.equal(result.media.media_type, contentType.startsWith("image/") ? "image" : "video");
  }
});

test("rejects spoofed, empty, truncated, HTML-polyglot, oversized, path-named, and cross-scope attachments without residue", async (t) => {
  const { db, mediaRoot, service } = await fixture(t);
  const invalid = [
    input(Buffer.alloc(0)),
    input(png.subarray(0, -12)),
    input(Buffer.concat([png, Buffer.from("<html><script>x</script></html>")])),
    input(png, { declaredFileType: "image/jpeg" }),
    input(png, { attachment: { source: "openclaw_chat_attachment", attachment_id: "a", original_filename: "../creative.png", declared_content_type: "image/png" } }),
    input(png, { clientId: "other-client" }),
  ];
  for (const candidate of invalid) {
    await assert.rejects(service.stage(candidate), (error: unknown) => error instanceof MediaError && [409, 413, 422].includes(error.status));
  }
  const limited = await fixture(t, { maxBytes: png.length - 1 });
  await assert.rejects(limited.service.stage(input(png)), (error: unknown) => error instanceof MediaError && error.code === "media_too_large");
  await assert.rejects(service.stage(input(mp4.subarray(0, -1), {
    declaredFileType: "video/mp4",
    attachment: { source: "openclaw_chat_attachment", attachment_id: "truncated-mp4", original_filename: "creative.mp4", declared_content_type: "video/mp4" },
  })), (error: unknown) => error instanceof MediaError && error.code === "media_invalid");
  assert.equal(db.prepare("SELECT count(*) AS count FROM staged_media").get()!.count, 0);
  assert.deepEqual(await readdir(mediaRoot), []);
  assert.deepEqual(await readdir(limited.mediaRoot), []);
});

test("authorizes exact scope before consuming bytes or creating temporary files", async (t) => {
  const { mediaRoot, service } = await fixture(t);
  let consumed = false;
  const bytes = (async function* () { consumed = true; yield png; })();
  await assert.rejects(service.stage(input(png, { clientId: "unauthorized", bytes })), (error: unknown) => error instanceof MediaError && error.code === "client_account_mismatch");
  assert.equal(consumed, false);
  assert.deepEqual(await readdir(mediaRoot), []);
});

test("database rejects non-positive media generations and non-canonical 12-hour expiry", async (t) => {
  const { db, mediaRoot, service } = await fixture(t);
  const staged = await service.stage(input(png));
  const copy = (id: string, generation: string, storage: string, expires: string) => db.prepare(`
    INSERT INTO staged_media
      (id, client_id, ad_account_id, generation_id, sha256, media_type, content_type, size_bytes,
       original_filename, attachment_id, alt_text, actor, correlation_id, storage_name, status, created_at, expires_at)
    SELECT ?, client_id, ad_account_id, ?, sha256, media_type, content_type, size_bytes,
       original_filename, attachment_id, alt_text, actor, correlation_id, ?, status, created_at, ?
    FROM staged_media WHERE id = ?
  `).run(id, generation, storage, expires, staged.media.media_id);
  assert.throws(() => copy("bad-expiry", "generation-1", "10000000-0000-4000-8000-000000000001", "2026-08-19T23:59:59.999Z"), /constraint|expiry/i);
  db.exec(`
    INSERT INTO integration_generations (id, integration_id, generation, status, validated_at)
      VALUES ('generation-zero', 'integration-1', '0', 'active', '${now.toISOString()}');
    INSERT INTO scope_mappings (client_id, ad_account_id, generation_id, active)
      VALUES ('client-1', 'act_1', 'generation-zero', 0);
  `);
  assert.throws(() => copy("bad-generation", "generation-zero", "10000000-0000-4000-8000-000000000002", staged.media.expires_at), /constraint|generation/i);
});

test("rejects malformed JPEG scans, corrupt PNG CRCs, MP4 without moov, and Unicode format filenames", async (t) => {
  const { service } = await fixture(t);
  const corruptPng = Buffer.from(png);
  corruptPng[corruptPng.length - 5] = corruptPng[corruptPng.length - 5]! ^ 1;
  const malformed = [
    input(Buffer.from("ffd8ffe000104a46494600010100000100010000ffd9", "hex"), { declaredFileType: "image/jpeg", attachment: { source: "openclaw_chat_attachment", attachment_id: "bad-jpeg", original_filename: "bad.jpg", declared_content_type: "image/jpeg" } }),
    input(corruptPng),
    input(Buffer.from("000000186674797069736f6d0000020069736f6d69736f320000000c6d64617400000000", "hex"), { declaredFileType: "video/mp4", attachment: { source: "openclaw_chat_attachment", attachment_id: "bad-mp4", original_filename: "bad.mp4", declared_content_type: "video/mp4" } }),
    input(png, { attachment: { source: "openclaw_chat_attachment", attachment_id: "bad-name", original_filename: "safe\u202Egnp.exe", declared_content_type: "image/png" } }),
  ];
  for (const candidate of malformed) await assert.rejects(service.stage(candidate), (error: unknown) => error instanceof MediaError && error.code === "media_invalid");
});

test("rejects a valid-CRC duplicate IHDR after IDAT", async (t) => {
  const { service } = await fixture(t);
  const [signature, ihdr, idat, iend] = pngParts(png);
  const duplicate = Buffer.concat([signature!, ihdr!, idat!, ihdr!, iend!]);
  await assert.rejects(service.stage(input(duplicate)), (error: unknown) => error instanceof MediaError && error.code === "media_invalid");
});

test("rejects out-of-order, non-contiguous, duplicate, and unknown critical PNG chunks", async (t) => {
  const { db, mediaRoot, service } = await fixture(t);
  const [signature, ihdr, idat, iend] = pngParts(png);
  const truecolorHeader = Buffer.from(ihdr!.subarray(8, -4));
  truecolorHeader[8] = 8;
  truecolorHeader[9] = 2;
  const indexedHeader = Buffer.from(truecolorHeader);
  indexedHeader[9] = 3;
  const palette = pngChunk("PLTE", Buffer.from([0, 0, 0]));
  const invalid = [
    Buffer.concat([signature!, pngChunk("IHDR", truecolorHeader), idat!, palette, iend!]),
    Buffer.concat([signature!, pngChunk("IHDR", indexedHeader), palette, pngChunk("PLTE", Buffer.from([1, 1, 1])), idat!, iend!]),
    Buffer.concat([signature!, pngChunk("IHDR", truecolorHeader), idat!, pngChunk("tRNS", Buffer.alloc(6)), iend!]),
    Buffer.concat([signature!, ihdr!, idat!, pngChunk("tEXt", Buffer.from("k\0v")), idat!, iend!]),
    Buffer.concat([signature!, ihdr!, pngChunk("ABCD"), idat!, iend!]),
    Buffer.concat([signature!, ihdr!, idat!, iend!, iend!]),
  ];
  for (const bytes of invalid) {
    await assert.rejects(service.stage(input(bytes)), (error: unknown) => error instanceof MediaError && error.code === "media_invalid");
  }
  assert.equal(db.prepare("SELECT count(*) AS count FROM staged_media").get()!.count, 0);
  assert.deepEqual(await readdir(mediaRoot), []);
});

test("fails closed when the initialized media root is swapped to a symlink", async (t) => {
  const { root, mediaRoot, service } = await fixture(t);
  const staged = await service.stage(input(png));
  const outside = await mkdtemp(join(tmpdir(), "fb-marketing-server-media-swap-outside-"));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await rename(mediaRoot, join(root, "parked-media"));
  await symlink(outside, mediaRoot);
  await assert.rejects(service.stage(input(png)), /media root|symlink|unsafe/i);
  await assert.rejects(service.cleanupExpired(new Date(staged.media.expires_at)), /media root|symlink|unsafe/i);
  assert.deepEqual(await readdir(outside), []);
});

test("destroys timed-out upload I/O and prevents delayed publication", async (t) => {
  const { mediaRoot, service } = await fixture(t, { timeoutMs: 10 });
  let destroyed = false;
  const stream = new Readable({ read() {}, destroy(error, callback) { destroyed = true; callback(error); } });
  await assert.rejects(service.stage(input(png, { bytes: stream })), (error: unknown) => error instanceof MediaError && error.code === "media_invalid");
  assert.equal(destroyed, true);
  stream.push(png);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(await readdir(mediaRoot), []);
});

test("aborts hanging uploads and expires staged files exactly at the 12-hour boundary", async (t) => {
  const { db, mediaRoot, service } = await fixture(t, { timeoutMs: 1_000 });
  const controller = new AbortController();
  const hanging = input(png, {
    signal: controller.signal,
    bytes: { async *[Symbol.asyncIterator]() { await new Promise(() => undefined); } },
  });
  setTimeout(() => controller.abort(), 10);
  await assert.rejects(service.stage(hanging), (error: unknown) => error instanceof MediaError && error.code === "media_invalid");
  assert.deepEqual(await readdir(mediaRoot), []);

  const staged = await service.stage(input(png));
  const row = db.prepare("SELECT storage_name FROM staged_media WHERE id = ?").get(staged.media.media_id)!;
  assert.equal(await service.cleanupExpired(new Date(staged.media.expires_at)), 1);
  assert.equal(db.prepare("SELECT status FROM staged_media WHERE id = ?").get(staged.media.media_id)!.status, "expired");
  await assert.rejects(stat(join(mediaRoot, String(row.storage_name))));

  const bound = await service.stage(input(png, { requestId: "request-bound-expiry", attachment: { source: "openclaw_chat_attachment", attachment_id: "bound-expiry", original_filename: "creative.png", declared_content_type: "image/png" } }));
  db.prepare("UPDATE staged_media SET status = 'bound' WHERE id = ?").run(bound.media.media_id);
  assert.equal(await service.cleanupExpired(new Date(bound.media.expires_at)), 1);
  assert.equal(db.prepare("SELECT status FROM staged_media WHERE id = ?").get(bound.media.media_id)!.status, "expired");
  assert.throws(() => db.prepare("UPDATE staged_media SET status = 'staged' WHERE id = ?").run(bound.media.media_id), /transition/i);
});

test("applies one total upload deadline rather than resetting the timer for every chunk", async (t) => {
  const { service } = await fixture(t, { timeoutMs: 15 });
  const bytes = (async function* () {
    for (let offset = 0; offset < png.length; offset += 10) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      yield png.subarray(offset, offset + 10);
    }
  })();
  await assert.rejects(service.stage(input(png, { bytes })), (error: unknown) => error instanceof MediaError && error.code === "media_invalid");
});

test("rejects symlinked media roots without mutating their targets", async (t) => {
  const parent = await mkdtemp(join(tmpdir(), "fb-marketing-server-media-link-"));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const target = join(parent, "target");
  const link = join(parent, "link");
  await mkdir(target);
  await chmod(target, 0o755);
  await symlink(target, link);
  const db = openDatabase(":memory:");
  t.after(() => db.close());
  await assert.rejects(createMediaService({ db, dataRoot: parent, mediaRoot: link }), /unsafe/);
  assert.equal((await stat(target)).mode & 0o777, 0o755);
});

test("rejects a symlinked media parent before creating anything through it", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "fb-marketing-server-media-parent-"));
  const outside = await mkdtemp(join(tmpdir(), "fb-marketing-server-media-outside-"));
  t.after(() => Promise.all([rm(root, { recursive: true, force: true }), rm(outside, { recursive: true, force: true })]));
  await symlink(outside, join(root, "linked"));
  const db = openDatabase(":memory:");
  t.after(() => db.close());
  await assert.rejects(createMediaService({ db, dataRoot: root, mediaRoot: join(root, "linked", "media") }), /symlink|unsafe/);
  await assert.rejects(stat(join(outside, "media")));
});

function multipart(parts: Array<{ name: string; value: string | Buffer; filename?: string; contentType?: string }>) {
  const boundary = "fb-marketing-server-boundary";
  const chunks: Buffer[] = [];
  for (const part of parts) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${part.name}"${part.filename ? `; filename="${part.filename}"` : ""}\r\n`));
    if (part.contentType) chunks.push(Buffer.from(`Content-Type: ${part.contentType}\r\n`));
    chunks.push(Buffer.from("\r\n"), Buffer.isBuffer(part.value) ? part.value : Buffer.from(part.value), Buffer.from("\r\n"));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}

test("media route enforces one file and exact fields while preserving request correlation and hiding paths", async (t) => {
  const { db, mediaRoot, service } = await fixture(t);
  const app = await buildApp({ serviceToken: "service-token", handlers: createMediaHandlers(service, "openclaw:user-1") });
  t.after(() => app.close());
  const attachment = JSON.stringify({ source: "openclaw_chat_attachment", attachment_id: "attachment-1", original_filename: "creative.png", declared_content_type: "image/png" });
  const base = [
    { name: "client_id", value: "client-1" },
    { name: "ad_account_id", value: "act_1" },
    { name: "attachment", value: attachment, contentType: "application/json" },
    { name: "file", value: png, filename: "creative.png", contentType: "image/png" },
  ];
  const valid = multipart(base);
  const response = await app.inject({
    method: "POST",
    url: "/v1/media",
    headers: { authorization: "Bearer service-token", "x-request-id": "request-route-media", "content-type": valid.contentType },
    payload: valid.body,
  });
  assert.equal(response.statusCode, 201);
  assert.equal(response.headers["x-request-id"], "request-route-media");
  assert.equal(response.json().request_id, "request-route-media");
  assert.doesNotMatch(response.body, /creative\.png|fb-marketing-server-media|storage_name/);

  const fileFirstBody = multipart([base[3]!, base[0]!, base[1]!, { ...base[2]!, value: JSON.stringify({ source: "openclaw_chat_attachment", attachment_id: "attachment-file-first", original_filename: "creative.png", declared_content_type: "image/png" }) }]);
  const fileFirst = await app.inject({
    method: "POST",
    url: "/v1/media",
    headers: { authorization: "Bearer service-token", "x-request-id": "request-file-first", "content-type": fileFirstBody.contentType },
    payload: fileFirstBody.body,
  });
  assert.equal(fileFirst.statusCode, 201);
  assert.equal(fileFirst.json().request_id, "request-file-first");

  for (const parts of [
    [...base, { name: "client_id", value: "client-1" }],
    [...base, { name: "url", value: "https://attacker.invalid/media" }],
    [...base, { name: "file", value: png, filename: "second.png", contentType: "image/png" }],
  ]) {
    const body = multipart(parts);
    const invalid = await app.inject({
      method: "POST",
      url: "/v1/media",
      headers: { authorization: "Bearer service-token", "x-request-id": "request-invalid-media", "content-type": body.contentType },
      payload: body.body,
    });
    assert.equal(invalid.statusCode, 422);
    assert.equal(invalid.json().code, "media_invalid");
    assert.doesNotMatch(invalid.body, /attacker|creative\.png|fb-marketing-server-media/);
  }

  const hash = createHash("sha256").update(png).digest("hex");
  assert.equal(response.json().media.sha256, hash);

  const namesBeforeFailure = await readdir(mediaRoot);
  const invalidScope = multipart([base[3]!, { ...base[0]!, value: "unauthorized" }, base[1]!, base[2]!]);
  const failed = await app.inject({
    method: "POST",
    url: "/v1/media",
    headers: { authorization: "Bearer service-token", "x-request-id": "bad", "content-type": invalidScope.contentType },
    payload: invalidScope.body,
  });
  const generated = failed.headers["x-request-id"];
  assert.match(String(generated), /^[0-9a-f-]{36}$/);
  assert.equal(failed.json().request_id, generated);
  assert.equal(db.prepare("SELECT correlation_id FROM audit_log WHERE logical_operation = 'stage_media' ORDER BY rowid DESC").get()!.correlation_id, generated);
  assert.equal(db.prepare("SELECT count(*) AS count FROM staged_media").get()!.count, 2);
  assert.deepEqual(await readdir(mediaRoot), namesBeforeFailure);
});
