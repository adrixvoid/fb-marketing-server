import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdtemp, mkdir, readFile, rename, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import {
  TOOL_NAMES,
  assertLoopbackBaseUrl,
  createGatewayClient,
  createOpenClawRegistration,
  createStageMediaCommandHandler,
  handleStageMediaCommand,
  readTrustedAttachment,
} from "../packages/openclaw-plugin/src/core.js";

const scope = { client_id: "client-1", ad_account_id: "act_1" };
const execFileAsync = promisify(execFile);

test("registers exactly eight scoped model tools without a media or decision tool", () => {
  const registered = createOpenClawRegistration({
    config: {
      baseUrl: "http://127.0.0.1:3000",
      keychainService: "fb-marketing-server",
      serviceTokenAccount: "openclaw-service-token",
      ownerProofAccount: "owner-proof-hmac-key",
      attachmentRoots: [],
    },
    gateway: {} as never,
  });

  assert.deepEqual(registered.tools.map((tool) => tool.name), TOOL_NAMES);
  assert.deepEqual(registered.commands.map((command) => command.name), ["approve-ad", "reject-ad"]);
  assert.equal(registered.tools.some((tool) => /approve|reject|upload|media/.test(tool.name)), false);
  for (const tool of registered.tools.filter((item) => !["list_scopes", "integration_status", "budget_summary"].includes(item.name))) {
    assert.ok(tool.parameters.required.includes("client_id"));
    assert.ok(tool.parameters.required.includes("ad_account_id"));
  }
  const budget = registered.tools.find((tool) => tool.name === "budget_summary")!;
  assert.ok(budget.parameters.anyOf[0].required.includes("client_id"));
  assert.deepEqual(budget.parameters.anyOf[1].required, ["global"]);
});

test("owner commands reject unauthorized or ambiguous input before secrets or HTTP", async () => {
  let secrets = 0;
  let requests = 0;
  const registered = createOpenClawRegistration({
    config: { baseUrl: "http://127.0.0.1:3000", keychainService: "svc", serviceTokenAccount: "token", ownerProofAccount: "proof", attachmentRoots: [] },
    gateway: {
      request: async () => { requests += 1; return {}; },
      secret: async () => { secrets += 1; return "secret"; },
    } as never,
  });
  const approve = registered.commands[0]!;
  const base = { channel: "discord", senderId: "owner", senderIsOwner: true, config: { commands: { ownerAllowFrom: ["discord:owner"] } } };

  assert.match((await approve.handler({ ...base, isAuthorizedSender: false, args: "018f0f4a-2f89-7c66-8f4f-9f0be5f67462" } as never)).text, /not authorized/i);
  assert.match((await approve.handler({ ...base, senderIsOwner: false, isAuthorizedSender: true, args: "018f0f4a-2f89-7c66-8f4f-9f0be5f67462" } as never)).text, /not authorized/i);
  assert.match((await approve.handler({ ...base, isAuthorizedSender: true, args: "yes approve it" } as never)).text, /UUID/i);
  assert.equal(secrets, 0);
  assert.equal(requests, 0);
});

test("authorized owner command discovers explicit scope and signs an exact empty-body request", async () => {
  const proofKey = Buffer.alloc(32, 7).toString("base64");
  const calls: Array<{ method: string; path: string; options?: any }> = [];
  const gateway = {
    secret: async () => proofKey,
    request: async (method: string, path: string, options?: any) => {
      calls.push({ method, path, options });
      if (path === "/v1/scopes") return { data: [scope], page: { next_cursor: null } };
      if (method === "GET") return { operation: { operation_id: "018f0f4a-2f89-7c66-8f4f-9f0be5f67462" } };
       return { request_id: "request-owner-command", operation: { status: "succeeded", result: { status: "succeeded" } } };
    },
  };
  const command = createOpenClawRegistration({
    config: { baseUrl: "http://127.0.0.1:3000", keychainService: "svc", serviceTokenAccount: "token", ownerProofAccount: "proof", attachmentRoots: [] },
    gateway: gateway as never,
  }).commands[0]!;
  const result = await command.handler({ channel: "discord", senderId: "owner", isAuthorizedSender: true, senderIsOwner: true, args: "018f0f4a-2f89-7c66-8f4f-9f0be5f67462", config: { commands: { ownerAllowFrom: ["discord:owner"] } } });

  assert.match(result.text, /succeeded.*request-owner-command/i);
  const submitted = calls[2]!;
  assert.equal(submitted.method, "POST");
  assert.equal(submitted.path, "/v1/operations/018f0f4a-2f89-7c66-8f4f-9f0be5f67462/approve?client_id=client-1&ad_account_id=act_1");
  assert.equal(submitted.options.body, undefined);
  assert.equal(submitted.options.json, undefined);
  assert.equal(submitted.options.form, undefined);
  const encoded = submitted.options.headers["x-openclaw-owner-command"] as string;
  const [version, issuedAt, nonce, owner, signature] = encoded.split(".");
  assert.equal(Buffer.from(owner!, "base64url").toString(), "discord:owner");
  const expected = createHmac("sha256", Buffer.from(proofKey, "base64")).update([
    version,
    "POST",
    submitted.path,
    "approved",
    "018f0f4a-2f89-7c66-8f4f-9f0be5f67462",
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "discord:owner",
    issuedAt,
    nonce,
  ].join("\n")).digest("base64url");
  assert.equal(signature, expected);
});

test("gateway accepts only an exact loopback HTTP base and refuses redirects", async () => {
  assert.equal(assertLoopbackBaseUrl("http://127.0.0.1:3000").href, "http://127.0.0.1:3000/");
  for (const invalid of ["https://127.0.0.1:3000", "http://localhost:3000", "http://user@127.0.0.1:3000", "http://127.0.0.1:3000/path", "http://127.0.0.1:3000?next=x"]) {
    assert.throws(() => assertLoopbackBaseUrl(invalid), /loopback gateway URL/i);
  }
  const client = createGatewayClient({
    baseUrl: "http://127.0.0.1:3000",
    getServiceToken: async () => "token-canary",
    fetch: async () => new Response(null, { status: 302, headers: { location: "http://example.com" } }),
  });
  await assert.rejects(client.request("GET", "/health"), /redirect/i);
});

test("trusted attachments stay beneath configured roots and reject symlinks", async () => {
  const root = await mkdtemp(join(tmpdir(), "openclaw-media-"));
  const outside = await mkdtemp(join(tmpdir(), "openclaw-outside-"));
  await mkdir(join(root, "nested"));
  const trusted = join(root, "nested", "creative.png");
  await writeFile(trusted, Buffer.from("trusted-bytes"));
  const escaped = join(root, "escape.png");
  const linkedDirectory = join(root, "linked-directory");
  await writeFile(join(outside, "secret.png"), Buffer.from("outside"));
  await symlink(join(outside, "secret.png"), escaped);
  await symlink(join(root, "nested"), linkedDirectory);
  const linkedRoot = join(outside, "linked-root");
  await symlink(root, linkedRoot);

  const file = await readTrustedAttachment({ path: trusted, contentType: "image/png", roots: [root] });
  assert.equal(file.bytes.toString(), "trusted-bytes");
  await assert.rejects(readTrustedAttachment({ path: escaped, contentType: "image/png", roots: [root] }), /trusted attachment/i);
  await assert.rejects(readTrustedAttachment({ path: join(linkedDirectory, "creative.png"), contentType: "image/png", roots: [root] }), /trusted attachment/i);
  await assert.rejects(readTrustedAttachment({ path: join(outside, "secret.png"), contentType: "image/png", roots: [root] }), /trusted attachment/i);
  await assert.rejects(readTrustedAttachment({ path: trusted, contentType: "image/png", roots: [linkedRoot] }), /trusted attachment/i);
});

test("trusted attachment read fails closed when its configured root is replaced", async () => {
  const parent = await mkdtemp(join(tmpdir(), "openclaw-root-race-"));
  const root = join(parent, "root");
  const moved = join(parent, "moved");
  await mkdir(root);
  const path = join(root, "creative.png");
  await writeFile(path, "trusted-bytes");

  await assert.rejects(readTrustedAttachment({
    path,
    contentType: "image/png",
    roots: [root],
    afterOpen: async () => {
      await rename(root, moved);
      await mkdir(root);
      await writeFile(path, "replacement-bytes");
    },
  }), /trusted attachment/i);
});

test("same-message owner command stages one trusted attachment without exposing its path", async () => {
  const root = await mkdtemp(join(tmpdir(), "openclaw-upload-"));
  const path = join(root, "creative.png");
  await writeFile(path, Buffer.from("png-fixture"));
  let submitted: any;
  const result = await handleStageMediaCommand({
    config: { baseUrl: "http://127.0.0.1:3000", keychainService: "svc", serviceTokenAccount: "token", ownerProofAccount: "proof", attachmentRoots: [root] },
    gateway: { secret: async () => "", request: async (_method: string, _path: string, options: any) => {
      submitted = options;
      return { request_id: "request-1", scope, media: { media_id: "media-1", sha256: "a".repeat(64), content_type: "image/png", size_bytes: 11, expires_at: "2026-09-07T00:00:00.000Z" } };
    } } as never,
    ownerAllowFrom: ["telegram:sender-1"],
    now: () => 1_000_000,
    context: { channelId: "telegram", accountId: "main", conversationId: "chat-1", senderId: "sender-1", messageId: "message-1" },
    event: {
      content: "/stage-ad-media client-1 act_1", timestamp: 1_000_000, channel: "telegram", senderId: "sender-1", messageId: "message-1",
      commandAuthorized: true, senderIsOwner: true, media: [{ path, contentType: "image/png", messageId: "message-1" }],
    },
  });

  assert.equal(result.handled, true);
  assert.match(result.reply!.text, /Staged media-1.*client-1\/act_1.*Request request-1/);
  assert.equal(submitted.form.get("client_id"), "client-1");
  assert.equal(submitted.form.get("ad_account_id"), "act_1");
  const attachment = JSON.parse(submitted.form.get("attachment"));
  assert.match(attachment.attachment_id, /^oc_[a-f0-9]{64}$/);
  assert.deepEqual({ ...attachment, attachment_id: "opaque" }, {
    source: "openclaw_chat_attachment",
    attachment_id: "opaque",
    original_filename: "creative.png",
    declared_content_type: "image/png",
  });
  assert.equal(JSON.stringify(result).includes(path), false);
});

test("stage command rejects unauthorized, malformed, missing, multiple, expired, and mismatched-message claims before I/O", async () => {
  const root = await mkdtemp(join(tmpdir(), "openclaw-context-"));
  const path = join(root, "creative.png");
  await writeFile(path, "bytes");
  let requests = 0;
  const base = {
    config: { baseUrl: "http://127.0.0.1:3000", keychainService: "svc", serviceTokenAccount: "token", ownerProofAccount: "proof", attachmentRoots: [root] },
    ownerAllowFrom: ["telegram:owner"], now: () => 1_000_000,
    context: { channelId: "telegram", senderId: "owner", messageId: "message-1" },
    gateway: { request: async () => { requests += 1; return {}; }, secret: async () => "" } as never,
  };
  const validEvent = { content: "/stage-ad-media client-1 act_1", timestamp: 1_000_000, channel: "telegram", senderId: "owner", messageId: "message-1", commandAuthorized: true, senderIsOwner: true, media: [{ path, contentType: "image/png", messageId: "message-1" }] };
  const cases = [
    { ...validEvent, commandAuthorized: false },
    { ...validEvent, senderIsOwner: false },
    { ...validEvent, content: "/stage-ad-media client-1" },
    { ...validEvent, media: [] },
    { ...validEvent, media: [validEvent.media[0]!, validEvent.media[0]!] },
    { ...validEvent, timestamp: 699_999 },
    { ...validEvent, media: [{ ...validEvent.media[0], messageId: "message-2" }] },
    { ...validEvent, mediaStagingPending: true },
  ];
  for (const event of cases) {
    const result = await handleStageMediaCommand({ ...base, event });
    assert.equal(result.handled, true);
    assert.doesNotMatch(result.reply!.text, new RegExp(path));
  }
  assert.equal(requests, 0);
});

test("stage command single-flights concurrent duplicates, replays results, and isolates distinct messages", async () => {
  const root = await mkdtemp(join(tmpdir(), "openclaw-idempotency-"));
  await writeFile(join(root, "one.png"), "one");
  await writeFile(join(root, "two.png"), "two");
  await writeFile(join(root, "three.png"), "three");
  const handle = createStageMediaCommandHandler();
  let requests = 0;
  const input = (messageId: string, filename: string) => ({
    config: { baseUrl: "http://127.0.0.1:3000", keychainService: "svc", serviceTokenAccount: "token", ownerProofAccount: "proof", attachmentRoots: [root] },
    ownerAllowFrom: ["telegram:owner"],
    now: () => 1_000_000,
    context: { channelId: "telegram", accountId: "main", conversationId: "chat", senderId: "owner", messageId },
    event: { content: "/stage-ad-media client-1 act_1", timestamp: 1_000_000, channel: "telegram", senderId: "owner", messageId, commandAuthorized: true, senderIsOwner: true, media: [{ path: join(root, filename), contentType: "image/png", messageId }] },
    gateway: { secret: async () => "", request: async () => {
      const request = ++requests;
      await new Promise((resolve) => setImmediate(resolve));
      return { request_id: `request-${request}`, scope, media: { media_id: `media-${request}`, sha256: "a".repeat(64), content_type: "image/png", size_bytes: 3, expires_at: "2026-09-07T00:00:00.000Z" } };
    } } as never,
  });

  const duplicate = await Promise.all([handle(input("message-1", "one.png")), handle(input("message-1", "one.png"))]);
  assert.deepEqual(duplicate[0], duplicate[1]);
  assert.equal(requests, 1);
  assert.deepEqual(await handle(input("message-1", "two.png")), duplicate[0]);
  assert.equal(requests, 1);

  const distinct = await Promise.all([handle(input("message-2", "two.png")), handle(input("message-3", "three.png"))]);
  assert.equal(requests, 3);
  assert.notEqual(distinct[0].reply!.text, distinct[1].reply!.text);
});

test("stage command freshness is replay-safe for stale/fresh races, future times, and the exact boundary", async () => {
  const root = await mkdtemp(join(tmpdir(), "openclaw-freshness-"));
  const path = join(root, "creative.png");
  await writeFile(path, "bytes");
  let requests = 0;
  const gateway = { secret: async () => "", request: async () => {
    requests += 1;
    return { request_id: `request-${requests}`, scope, media: { media_id: `media-${requests}`, sha256: "a".repeat(64), content_type: "image/png", size_bytes: 5, expires_at: "2026-09-07T00:00:00.000Z" } };
  } } as never;
  const command = (handler: ReturnType<typeof createStageMediaCommandHandler>, messageId: string, timestamp: number) => handler({
    config: { baseUrl: "http://127.0.0.1:3000", keychainService: "svc", serviceTokenAccount: "token", ownerProofAccount: "proof", attachmentRoots: [root] },
    gateway,
    ownerAllowFrom: ["telegram:owner"],
    now: () => 1_000_000,
    context: { channelId: "telegram", senderId: "owner", messageId },
    event: { content: "/stage-ad-media client-1 act_1", timestamp, channel: "telegram", senderId: "owner", messageId, commandAuthorized: true, senderIsOwner: true, media: [{ path, contentType: "image/png", messageId }] },
  });

  const raceHandler = createStageMediaCommandHandler();
  const race = await Promise.all([command(raceHandler, "race", 699_999), command(raceHandler, "race", 1_000_000)]);
  assert.deepEqual(race[0], race[1]);
  assert.match(race[0].reply!.text, /failed/i);
  assert.match((await command(createStageMediaCommandHandler(), "future", 1_000_001)).reply!.text, /failed/i);
  assert.match((await command(createStageMediaCommandHandler(), "boundary", 700_000)).reply!.text, /Staged/);
  assert.equal(requests, 1);
});

test("stage command bounds replay memory and releases expired entries", async () => {
  const handle = createStageMediaCommandHandler();
  let now = 1_000_000;
  const input = (messageId: string) => ({
    config: { baseUrl: "http://127.0.0.1:3000", keychainService: "svc", serviceTokenAccount: "token", ownerProofAccount: "proof", attachmentRoots: ["unused"] },
    gateway: { secret: async () => "", request: async () => { throw new Error("must not request"); } } as never,
    ownerAllowFrom: ["telegram:owner"],
    now: () => now,
    context: { channelId: "telegram", senderId: "owner", messageId },
    event: { content: "/stage-ad-media client-1 act_1", timestamp: now, channel: "telegram", senderId: "owner", messageId, commandAuthorized: true, senderIsOwner: true, media: [] },
  });

  for (let index = 0; index < 1_024; index += 1) assert.match((await handle(input(`message-${index}`))).reply!.text, /exactly one fresh/i);
  assert.equal((await handle(input("at-capacity"))).reply!.text, "Media staging failed.");
  assert.match((await handle(input("message-0"))).reply!.text, /exactly one fresh/i);
  now += 5 * 60_000 + 1;
  assert.match((await handle(input("after-expiry"))).reply!.text, /exactly one fresh/i);
});

test("stage command rejects malformed or unsafe gateway response text with a generic error", async () => {
  const root = await mkdtemp(join(tmpdir(), "openclaw-response-"));
  const path = join(root, "creative.png");
  await writeFile(path, "bytes");
  const invalidResponses = [
    { request_id: "request-1", scope, media: { media_id: "media-1", sha256: "a".repeat(64), content_type: "image/png", size_bytes: 5, expires_at: "2026-09-07T00:00:00Z" } },
    { request_id: "request\u001b-2", scope, media: { media_id: "media-2", sha256: "a".repeat(64), content_type: "image/png", size_bytes: 5, expires_at: "2026-09-07T00:00:00.000Z" } },
    { request_id: "request-3", scope, media: { media_id: "media\t3", sha256: "a".repeat(64), content_type: "image/png", size_bytes: 5, expires_at: "not-a-date" } },
    { request_id: "request-4", scope, media: { media_id: "media-4", sha256: "a".repeat(64), content_type: "image/png", size_bytes: -1, expires_at: "2026-09-07T00:00:00.000Z" } },
  ];

  for (const [index, response] of invalidResponses.entries()) {
    const messageId = `invalid-response-${index}`;
    const result = await createStageMediaCommandHandler()({
      config: { baseUrl: "http://127.0.0.1:3000", keychainService: "svc", serviceTokenAccount: "token", ownerProofAccount: "proof", attachmentRoots: [root] },
      gateway: { secret: async () => "", request: async () => response } as never,
      ownerAllowFrom: ["telegram:owner"],
      now: () => 1_000_000,
      context: { channelId: "telegram", senderId: "owner", messageId },
      event: { content: "/stage-ad-media client-1 act_1", timestamp: 1_000_000, channel: "telegram", senderId: "owner", messageId, commandAuthorized: true, senderIsOwner: true, media: [{ path, contentType: "image/png", messageId }] },
    });
    assert.equal(result.reply!.text, "Media staging failed.");
    assert.equal(JSON.stringify(result).includes("request"), false);
  }
});

test("gateway timeouts and problem responses never leak token or response detail", async () => {
  const token = "service-token-canary";
  const timed = createGatewayClient({ baseUrl: "http://127.0.0.1:3000", timeoutMs: 10, getServiceToken: async () => token, fetch: async () => new Promise<Response>(() => {}) });
  await assert.rejects(timed.request("GET", "/health"), (error: Error) => !error.message.includes(token) && /failed/i.test(error.message));

  const failed = createGatewayClient({
    baseUrl: "http://127.0.0.1:3000",
    getServiceToken: async () => token,
    fetch: async (_url, init) => {
      const id = new Headers(init?.headers).get("x-request-id")!;
      return new Response(JSON.stringify({ code: "upstream_error", title: token, detail: token, request_id: id }), { status: 502, headers: { "content-type": "application/problem+json", "x-request-id": id } });
    },
  });
  await assert.rejects(failed.request("GET", "/health"), (error: Error) => error.message === "Gateway request failed" && !error.message.includes(token));
});

test("gateway deadline covers stalled bodies and enforces outbound correlation", async () => {
  let cancelled = false;
  const stalled = createGatewayClient({
    baseUrl: "http://127.0.0.1:3000", timeoutMs: 20, getServiceToken: async () => "token",
    fetch: async (_url, init) => {
      const id = new Headers(init?.headers).get("x-request-id")!;
      return new Response(new ReadableStream({ pull() {}, cancel() { cancelled = true; } }), { headers: { "x-request-id": id } });
    },
  });
  await assert.rejects(stalled.request("GET", "/health"), /Gateway request failed/);
  assert.equal(cancelled, true);

  const mismatch = createGatewayClient({
    baseUrl: "http://127.0.0.1:3000", getServiceToken: async () => "token",
    fetch: async () => new Response(JSON.stringify({ request_id: "body-id" }), { headers: { "x-request-id": "header-id" } }),
  });
  await assert.rejects(mismatch.request("GET", "/health"), /Gateway response correlation failed/);

  let oversizedCancelled = false;
  const oversized = createGatewayClient({
    baseUrl: "http://127.0.0.1:3000", getServiceToken: async () => "token",
    fetch: async (_url, init) => {
      const id = new Headers(init?.headers).get("x-request-id")!;
      return new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(2 * 1024 * 1024 + 1)); }, cancel() { oversizedCancelled = true; } }), { headers: { "x-request-id": id } });
    },
  });
  await assert.rejects(oversized.request("GET", "/health"), /too large/);
  assert.equal(oversizedCancelled, true);
});

test("clean checkout builds a six-file installable plugin against OpenClaw 2026.9.2", async () => {
  const packageRoot = join(process.cwd(), "packages", "openclaw-plugin");
  const destination = await mkdtemp(join(tmpdir(), "openclaw-pack-"));
  await execFileAsync(process.execPath, ["--run", "build"], { cwd: packageRoot });
  const packed = await execFileAsync("npm", ["pack", "--json", "--pack-destination", destination], { cwd: packageRoot });
  const [{ filename, files }] = JSON.parse(packed.stdout);
  assert.deepEqual(files.map((file: { path: string }) => file.path).sort(), ["dist/core.d.ts", "dist/core.js", "dist/index.d.ts", "dist/index.js", "openclaw.plugin.json", "package.json"]);
  const archive = join(destination, filename);
  const listed = await execFileAsync("/usr/bin/tar", ["-tf", archive]);
  assert.match(listed.stdout, /package\/dist\/index\.js/);
  assert.equal((await import(new URL("../packages/openclaw-plugin/dist/index.js", import.meta.url).href)).default.id, "fb-marketing-server");
  const metadata = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
  assert.equal(metadata.peerDependencies.openclaw, "2026.9.2");
});
