import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import {
  TOOL_NAMES,
  assertLoopbackBaseUrl,
  createGatewayClient,
  createOpenClawRegistration,
  readTrustedAttachment,
  TrustedAttachmentStore,
  attachmentContextKey,
} from "../packages/openclaw-plugin/src/core.js";

const scope = { client_id: "client-1", ad_account_id: "act_1" };
const execFileAsync = promisify(execFile);

test("registers exactly nine scoped model tools and two non-model owner commands", () => {
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
  assert.equal(registered.tools.some((tool) => /approve|reject/.test(tool.name)), false);
  for (const tool of registered.tools.filter((item) => !["list_scopes", "integration_status", "budget_summary"].includes(item.name))) {
    assert.ok(tool.parameters.required.includes("client_id"));
    assert.ok(tool.parameters.required.includes("ad_account_id"));
  }
  const budget = registered.tools.find((tool) => tool.name === "budget_summary")!;
  assert.ok(budget.parameters.anyOf[0].required.includes("client_id"));
  assert.deepEqual(budget.parameters.anyOf[1].required, ["global"]);
  const upload = registered.tools.find((tool) => tool.name === "upload_chat_media")!;
  assert.equal("path" in upload.parameters.properties, false);
  assert.equal("url" in upload.parameters.properties, false);
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
  const base = { channel: "discord", senderId: "owner", config: { commands: { ownerAllowFrom: ["discord:owner"] } } };

  assert.match((await approve.handler({ ...base, isAuthorizedSender: false, args: "018f0f4a-2f89-7c66-8f4f-9f0be5f67462" } as never)).text, /not authorized/i);
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
      return { status: "succeeded", request_id: "request-owner-command" };
    },
  };
  const command = createOpenClawRegistration({
    config: { baseUrl: "http://127.0.0.1:3000", keychainService: "svc", serviceTokenAccount: "token", ownerProofAccount: "proof", attachmentRoots: [] },
    gateway: gateway as never,
  }).commands[0]!;
  const result = await command.handler({ channel: "discord", senderId: "owner", isAuthorizedSender: true, args: "018f0f4a-2f89-7c66-8f4f-9f0be5f67462", config: { commands: { ownerAllowFrom: ["discord:owner"] } } });

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
  await writeFile(join(outside, "secret.png"), Buffer.from("outside"));
  await symlink(join(outside, "secret.png"), escaped);

  const file = await readTrustedAttachment({ path: trusted, contentType: "image/png", roots: [root] });
  assert.equal(file.bytes.toString(), "trusted-bytes");
  await assert.rejects(readTrustedAttachment({ path: escaped, contentType: "image/png", roots: [root] }), /trusted attachment/i);
  await assert.rejects(readTrustedAttachment({ path: join(outside, "secret.png"), contentType: "image/png", roots: [root] }), /trusted attachment/i);
});

test("upload tool consumes one trusted attachment and sends multipart without exposing its path", async () => {
  const root = await mkdtemp(join(tmpdir(), "openclaw-upload-"));
  const path = join(root, "creative.png");
  await writeFile(path, Buffer.from("png-fixture"));
  const attachments = new TrustedAttachmentStore([root]);
  attachments.capture(attachmentContextKey({ channel: "discord", account: "main", conversation: "chat-1", sender: "sender-1" })!, [path], ["image/png"], { channel: "discord", messageId: "message-1" });
  let submitted: any;
  const registered = createOpenClawRegistration({
    config: { baseUrl: "http://127.0.0.1:3000", keychainService: "svc", serviceTokenAccount: "token", ownerProofAccount: "proof", attachmentRoots: [root] },
    gateway: { secret: async () => "", request: async (_method: string, _path: string, options: any) => { submitted = options; return { media: { media_id: "media-1" } }; } } as never,
    attachments,
    toolContext: { messageChannel: "discord", agentAccountId: "main", requesterSenderId: "sender-1", deliveryContext: { to: "chat-1" } },
  });
  const upload = registered.tools.find((tool) => tool.name === "upload_chat_media")!;
  const result = await upload.execute("call-1", scope) as any;

  assert.equal(result.details.media.media_id, "media-1");
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
  await assert.rejects(upload.execute("call-2", scope), /trusted attachment/i);
});

test("attachment keys fail closed on absent identity and isolate sender and conversation", async () => {
  assert.equal(attachmentContextKey({ channel: "discord", account: "main", conversation: "chat-1", sender: "" }), undefined);
  assert.equal(attachmentContextKey({ channel: "discord", account: "main", conversation: "", sender: "sender-1" }), undefined);
  const root = await mkdtemp(join(tmpdir(), "openclaw-context-"));
  const path = join(root, "creative.png");
  await writeFile(path, "bytes");
  const store = new TrustedAttachmentStore([root]);
  store.capture(attachmentContextKey({ channel: "discord", account: "main", conversation: "chat-1", sender: "sender-1" })!, [path], [], { channel: "discord", messageId: "message-1" });
  await assert.rejects(store.take(attachmentContextKey({ channel: "discord", account: "main", conversation: "chat-1", sender: "sender-2" })), /trusted attachment/i);
  await assert.rejects(store.take(attachmentContextKey({ channel: "discord", account: "main", conversation: "chat-2", sender: "sender-1" })), /trusted attachment/i);
  assert.equal((await store.take(attachmentContextKey({ channel: "discord", account: "main", conversation: "chat-1", sender: "sender-1" }))).bytes.toString(), "bytes");
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
