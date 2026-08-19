import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { openDatabase } from "../src/db.js";
import { defaultRuntimePaths, createRuntime, runtimeEnvironment } from "../src/runtime.js";
import { encryptCredential, type SecretProvider } from "../src/secrets.js";

class FakeSecrets implements SecretProvider {
  readonly values = new Map<string, string>();
  async get(name: string) { return this.values.get(name); }
  async create(name: string, value: string) {
    if (this.values.has(name)) return false;
    this.values.set(name, value);
    return true;
  }
}

function mediaMultipart() {
  const boundary = "runtime-media-boundary";
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  const attachment = JSON.stringify({ source: "openclaw_chat_attachment", attachment_id: "attachment-1", original_filename: "creative.png", declared_content_type: "image/png" });
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="client_id"\r\n\r\nmissing\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="ad_account_id"\r\n\r\nmissing\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="attachment"\r\nContent-Type: application/json\r\n\r\n${attachment}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="creative.png"\r\nContent-Type: image/png\r\n\r\n`),
    png,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

test("runtime defaults to Application Support and production composition registers every Unit 3 handler", async (t) => {
  assert.deepEqual(defaultRuntimePaths("/Users/tester"), {
    dataRoot: "/Users/tester/Library/Application Support/fb-marketing-server",
    databasePath: "/Users/tester/Library/Application Support/fb-marketing-server/state.sqlite",
  });
  const root = await mkdtemp(join(tmpdir(), "fb-marketing-server-runtime-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  let closed = false;
  let metaCalled = false;
  const app = await createRuntime({
    serviceToken: "service-token",
    ownerIdentity: "discord:user-1",
    dataRoot: root,
    databasePath: join(root, "state.sqlite"),
    secretProvider: new FakeSecrets(),
    cursorKey: Buffer.alloc(32, 7),
    fetch: async () => {
      metaCalled = true;
      throw new Error("Meta must not run without a resolved scope");
    },
    testHooks: { onDatabaseClose: () => { closed = true; } },
  });
  const headers = { authorization: "Bearer service-token", "x-request-id": "request-runtime" };
  const media = mediaMultipart();
  const probes = [
    await app.inject({ method: "GET", url: "/v1/integration-status", headers }),
    await app.inject({ method: "GET", url: "/v1/scopes", headers }),
    await app.inject({ method: "GET", url: "/v1/capabilities?client_id=missing&ad_account_id=missing", headers }),
    await app.inject({ method: "GET", url: "/v1/campaigns?client_id=missing&ad_account_id=missing", headers }),
    await app.inject({
      method: "POST",
      url: "/v1/insights/query",
      headers: { ...headers, "content-type": "application/json" },
      payload: { client_id: "missing", ad_account_id: "missing", date_range: { since: "2026-08-01", until: "2026-08-19" }, level: "account" },
    }),
    await app.inject({ method: "GET", url: "/v1/budget-pacing?client_id=missing&ad_account_id=missing", headers }),
    await app.inject({ method: "POST", url: "/v1/media", headers: { ...headers, "content-type": media.contentType }, payload: media.body }),
    await app.inject({
      method: "POST",
      url: "/v1/operations",
      headers: { ...headers, "content-type": "application/json", "idempotency-key": "runtime-idempotency-1" },
      payload: { type: "configure_monthly_budget", client_id: "missing", ad_account_id: "missing", payload: { monthly_budget: { amount: "100.00", currency: "USD" } } },
    }),
    await app.inject({
      method: "POST",
      url: "/v1/operations/missing/approve?client_id=missing&ad_account_id=missing",
      headers: { ...headers, "x-openclaw-owner-command": "x".repeat(32) },
    }),
  ];
  assert.deepEqual(probes.map(({ statusCode }) => statusCode), [200, 200, 409, 409, 409, 409, 409, 409, 403]);
  assert.equal(probes[0]!.json().integration.state, "configuration_required");
  assert.deepEqual(probes[1]!.json().data, []);
  assert.equal(metaCalled, false);
  await app.close();
  assert.equal(closed, true);
});

test("runtime environment requires the documented service token and one channel-scoped owner", () => {
  assert.deepEqual(runtimeEnvironment({ OPENCLAW_SERVICE_TOKEN: "service-token", OPENCLAW_OWNER_IDENTITY: "discord:user-1" }), {
    serviceToken: "service-token",
    ownerIdentity: "discord:user-1",
    port: 3000,
  });
  assert.deepEqual(runtimeEnvironment({ OPENCLAW_SERVICE_TOKEN: "service-token", OPENCLAW_OWNER_IDENTITY: "discord:user-1", PORT: "3010" }), {
    serviceToken: "service-token",
    ownerIdentity: "discord:user-1",
    port: 3010,
  });
  assert.throws(() => runtimeEnvironment({ SERVICE_BEARER_TOKEN: "legacy-token" }), /OPENCLAW_SERVICE_TOKEN is required/);
  assert.throws(() => runtimeEnvironment({ OPENCLAW_SERVICE_TOKEN: "service-token" }), /OPENCLAW_OWNER_IDENTITY is required/);
  assert.throws(() => runtimeEnvironment({ OPENCLAW_SERVICE_TOKEN: "service-token", OPENCLAW_OWNER_IDENTITY: "bare-user", PORT: "3000" }), /Invalid OPENCLAW_OWNER_IDENTITY/);
  assert.throws(() => runtimeEnvironment({ OPENCLAW_SERVICE_TOKEN: "service-token", OPENCLAW_OWNER_IDENTITY: "discord:user-1", PORT: "0" }), /Invalid PORT/);
});

test("runtime decrypts scoped credentials just in time, audits Meta, and closes the DB on shutdown", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "fb-marketing-server-runtime-seeded-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "state.sqlite");
  const secrets = new FakeSecrets();
  await secrets.create("database-key", Buffer.alloc(32, 8).toString("base64"));
  const identity = { credentialId: "credential-1", generationId: "generation-1", subjectId: "subject-1" };
  const envelope = await encryptCredential(
    secrets,
    "database-key",
    identity,
    JSON.stringify({ accessToken: "META-TOKEN-CANARY", appSecret: "META-APP-SECRET-CANARY" }),
  );
  const db = openDatabase(path, root);
  db.prepare("INSERT INTO clients (id, name, portfolio_id) VALUES (?, ?, ?)").run("client-1", "Client One", "portfolio-1");
  db.prepare("INSERT INTO integrations (id, name, meta_app_id, state) VALUES (?, ?, ?, ?)").run("integration-1", "Agency App", "app-1", "active");
  db.prepare("INSERT INTO integration_generations (id, integration_id, generation, status, validated_at) VALUES (?, ?, ?, ?, ?)").run(
    "generation-1", "integration-1", "2026-08", "active", "2026-08-19T12:00:00.000Z",
  );
  db.prepare("INSERT INTO ad_accounts (id, client_id, name, currency, timezone) VALUES (?, ?, ?, ?, ?)").run(
    "act_1", "client-1", "Account One", "USD", "America/New_York",
  );
  db.prepare(`INSERT INTO scope_mappings
    (client_id, ad_account_id, generation_id, active, app_authorized, subject_authorized, partner_authorized, asset_authorized, granted_tasks)
    VALUES (?, ?, ?, 1, 1, 1, 1, 1, ?)`).run("client-1", "act_1", "generation-1", JSON.stringify(["ADVERTISE"]));
  db.prepare(`INSERT INTO encrypted_credentials
    (id, generation_id, subject_id, key_ref, envelope_version, ciphertext, iv, auth_tag, scopes, status, validated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`).run(
    identity.credentialId,
    identity.generationId,
    identity.subjectId,
    "database-key",
    envelope.version,
    envelope.ciphertext,
    envelope.iv,
    envelope.tag,
    JSON.stringify(["ads_read", "ads_management", "pages_read_engagement", "leads_retrieval", "instagram_basic"]),
    "2026-08-19T12:00:00.000Z",
  );
  db.close();

  let authorization: string | null = null;
  let closed = false;
  const app = await createRuntime({
    serviceToken: "service-token",
    ownerIdentity: "discord:user-1",
    dataRoot: root,
    databasePath: path,
    secretProvider: secrets,
    cursorKey: Buffer.alloc(32, 7),
    fetch: async (_input, init) => {
      authorization = new Headers(init?.headers).get("authorization");
      return new Response(JSON.stringify({ data: [{ id: "campaign-1", name: "Campaign", status: "ACTIVE", objective: "OUTCOME_SALES" }], paging: {} }), { status: 200 });
    },
    now: () => new Date("2026-08-19T12:00:00.000Z"),
    testHooks: { onDatabaseClose: () => { closed = true; } },
  });
  const response = await app.inject({
    method: "GET",
    url: "/v1/campaigns?client_id=client-1&ad_account_id=act_1",
    headers: { authorization: "Bearer service-token", "x-request-id": "request-runtime-seeded" },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(authorization, "Bearer META-TOKEN-CANARY");
  assert.doesNotMatch(JSON.stringify(response.json()), /META-TOKEN-CANARY|META-APP-SECRET-CANARY/);
  await app.close();
  assert.equal(closed, true);
  const verification = openDatabase(path, root);
  assert.equal(verification.prepare("SELECT count(*) AS count FROM audit_log").get()!.count, 2);
  verification.close();
});

test("runtime closes the database when application startup fails", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "fb-marketing-server-runtime-failure-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  let closed = false;
  await assert.rejects(
    createRuntime({
      serviceToken: "service-token",
      ownerIdentity: "discord:user-1",
      dataRoot: root,
      databasePath: join(root, "state.sqlite"),
      secretProvider: new FakeSecrets(),
      cursorKey: Buffer.alloc(32, 7),
      fetch: async () => new Response("{}"),
      buildApplication: async () => { throw new Error("startup failed"); },
      testHooks: { onDatabaseClose: () => { closed = true; } },
    }),
    /startup failed/,
  );
  assert.equal(closed, true);
});

test("runtime rejects a symlinked data root without changing its target permissions", async (t) => {
  const parent = await mkdtemp(join(tmpdir(), "fb-marketing-server-runtime-symlink-"));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const target = join(parent, "target");
  const link = join(parent, "link");
  await mkdir(target);
  await chmod(target, 0o755);
  await symlink(target, link);
  await assert.rejects(
    createRuntime({
      serviceToken: "service-token",
      ownerIdentity: "discord:user-1",
      dataRoot: link,
      databasePath: join(link, "state.sqlite"),
      secretProvider: new FakeSecrets(),
      cursorKey: Buffer.alloc(32, 7),
    }),
    /symlink/i,
  );
  assert.equal((await stat(target)).mode & 0o777, 0o755);
});
