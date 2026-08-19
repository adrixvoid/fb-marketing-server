import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { appendAudit, openDatabase, type AuditEvent } from "../src/db.js";
import {
  decryptCredential,
  encryptCredential,
  getOrCreateEncryptionKey,
  MacOSKeychainSecretProvider,
  type SecretProvider,
} from "../src/secrets.js";
import { resolveScope, withResolvedScope } from "../src/scope.js";

class FakeSecrets implements SecretProvider {
  readonly values = new Map<string, string>();
  async get(name: string) {
    return this.values.get(name);
  }
  async create(name: string, value: string) {
    if (this.values.has(name)) return false;
    this.values.set(name, value);
    return true;
  }
}

const identity = { credentialId: "credential-1", generationId: "generation-1", subjectId: "subject-1" };

function serializedError(error: unknown): string {
  const value = error as Error & { cause?: unknown };
  return JSON.stringify({ name: value.name, message: value.message, stack: value.stack, cause: value.cause });
}

test("Keychain prompts through stdin and never places secret material in argv or failures", async () => {
  const canary = "KEYCHAIN-SECRET-CANARY-4c31";
  const calls: Array<{ file: string; args: readonly string[]; stdin?: string }> = [];
  const provider = new MacOSKeychainSecretProvider("fb-marketing-server", async (file, args, stdin) => {
    calls.push({ file, args, ...(stdin === undefined ? {} : { stdin }) });
    return { code: 0, stdout: args[0] === "find-generic-password" ? `${canary}\n` : "" };
  });

  assert.equal(await provider.create("encryption-key", canary), true);
  assert.equal(await provider.get("encryption-key"), canary);
  assert.deepEqual(calls, [
    {
      file: "/usr/bin/security",
      args: ["add-generic-password", "-s", "fb-marketing-server", "-a", "encryption-key", "-w"],
      stdin: `${canary}\n`,
    },
    {
      file: "/usr/bin/security",
      args: ["find-generic-password", "-s", "fb-marketing-server", "-a", "encryption-key", "-w"],
    },
  ]);
  assert.equal(calls.some(({ args }) => args.some((argument) => argument.includes(canary))), false);

  const failing = new MacOSKeychainSecretProvider("fb-marketing-server", async () => {
    throw new Error(`command failed with ${canary}`);
  });
  let failure: unknown;
  try {
    await failing.create("encryption-key", canary);
  } catch (error) {
    failure = error;
  }
  assert.match(String(failure), /Keychain update failed/);
  assert.equal(serializedError(failure).includes(canary), false);
});

test("Keychain commands time out, abort the runner, and do not leave delayed timers", async () => {
  const canary = "KEYCHAIN-TIMEOUT-CANARY-6f3a";
  let aborted = false;
  const hanging = new MacOSKeychainSecretProvider(
    "fb-marketing-server",
    async (_file, _args, _stdin, signal) =>
      new Promise((_resolve, reject) => {
        signal?.addEventListener(
          "abort",
          () => {
            aborted = true;
            reject(new Error(`aborted ${canary}`));
          },
          { once: true },
        );
      }),
    20,
  );

  const outcome = await Promise.race([
    hanging.get("encryption-key").then(
      () => "resolved",
      (error: unknown) => serializedError(error),
    ),
    new Promise<string>((resolve) => setTimeout(() => resolve("test-hung"), 200)),
  ]);
  assert.notEqual(outcome, "test-hung");
  assert.match(outcome, /timed out/);
  assert.equal(outcome.includes(canary), false);
  assert.equal(aborted, true);

  let completedSignal: AbortSignal | undefined;
  const completing = new MacOSKeychainSecretProvider(
    "fb-marketing-server",
    async (_file, _args, _stdin, signal) => {
      completedSignal = signal;
      return { code: 44, stdout: "" };
    },
    10,
  );
  assert.equal(await completing.get("missing-key"), undefined);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(completedSignal?.aborted, false);
});

test("versioned AES-256-GCM envelopes reject malformed encodings and wrong bindings", async () => {
  const secrets = new FakeSecrets();
  await secrets.create("database-key", Buffer.alloc(32, 7).toString("base64"));
  const encrypted = await encryptCredential(secrets, "database-key", identity, "meta-token-canary");

  assert.equal(encrypted.version, 1);
  assert.doesNotMatch(JSON.stringify(encrypted), /meta-token-canary/);
  assert.equal(await decryptCredential(secrets, "database-key", identity, encrypted), "meta-token-canary");

  const malformed = [
    { ...encrypted, version: 2 },
    { ...encrypted, ciphertext: `${encrypted.ciphertext}!!!!` },
    { ...encrypted, ciphertext: "" },
    { ...encrypted, iv: Buffer.alloc(11).toString("base64") },
    { ...encrypted, tag: Buffer.alloc(15).toString("base64") },
  ];
  for (const envelope of malformed) {
    await assert.rejects(decryptCredential(secrets, "database-key", identity, envelope), /Credential decryption failed/);
  }
  await assert.rejects(
    decryptCredential(secrets, "database-key", { ...identity, subjectId: "other-subject" }, encrypted),
    /Credential decryption failed/,
  );
  await assert.rejects(
    decryptCredential(secrets, "database-key", identity, { ...encrypted, tag: Buffer.alloc(16).toString("base64") }),
    /Credential decryption failed/,
  );

  await secrets.create("bad-key", `${Buffer.alloc(32, 8).toString("base64")}!!!!`);
  await assert.rejects(encryptCredential(secrets, "bad-key", identity, "token"), /Credential key is unavailable/);
});

test("get-or-create encryption keys never replace a key that protects existing ciphertext", async () => {
  const secrets = new FakeSecrets();
  const first = await getOrCreateEncryptionKey(secrets, "database-key");
  const encrypted = await encryptCredential(secrets, "database-key", identity, "existing-token");
  const second = await getOrCreateEncryptionKey(secrets, "database-key");

  assert.equal(second, first);
  assert.equal(await decryptCredential(secrets, "database-key", identity, encrypted), "existing-token");
});

function seedAuthorizedScope(db: ReturnType<typeof openDatabase>) {
  db.prepare("INSERT INTO clients (id, name, portfolio_id) VALUES (?, ?, ?)").run("client-1", "Client One", "portfolio-1");
  db.prepare("INSERT INTO integrations (id, name, meta_app_id, state) VALUES (?, ?, ?, ?)").run(
    "integration-1",
    "Existing App",
    "app-1",
    "active",
  );
  db.prepare(
    "INSERT INTO integration_generations (id, integration_id, generation, status, validated_at) VALUES (?, ?, ?, ?, ?)",
  ).run("generation-1", "integration-1", "generation-1", "active", "2026-08-19T12:00:00.000Z");
  db.prepare("INSERT INTO ad_accounts (id, client_id, name, currency, timezone) VALUES (?, ?, ?, ?, ?)").run(
    "account-1",
    "client-1",
    "Account One",
    "USD",
    "America/New_York",
  );
  db.prepare(
    `INSERT INTO scope_mappings
      (client_id, ad_account_id, generation_id, active, app_authorized, subject_authorized, partner_authorized, asset_authorized, granted_tasks)
     VALUES (?, ?, ?, 1, 1, 1, 1, 1, ?)`,
  ).run("client-1", "account-1", "generation-1", JSON.stringify(["ADVERTISE"]));
  db.prepare(
    `INSERT INTO encrypted_credentials
      (id, generation_id, subject_id, key_ref, envelope_version, ciphertext, iv, auth_tag, scopes, status, validated_at)
     VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, 'active', ?)`,
  ).run(
    "credential-1",
    "generation-1",
    "subject-1",
    "database-key",
    "ciphertext",
    "iv",
    "tag",
    JSON.stringify(["ads_read"]),
    "2026-08-19T12:00:00.000Z",
  );
}

test("scope resolution fails closed before downstream work", async () => {
  const db = openDatabase(":memory:");
  try {
    seedAuthorizedScope(db);
    const resolved = resolveScope(db, { clientId: "client-1", adAccountId: "account-1" }, { task: "ADVERTISE", permission: "ads_read" });
    assert.deepEqual(resolved, {
      clientId: "client-1",
      clientName: "Client One",
      adAccountId: "account-1",
      adAccountName: "Account One",
      currency: "USD",
      timezone: "America/New_York",
      integrationId: "integration-1",
      generationId: "generation-1",
      credentialId: "credential-1",
    });

    let called = false;
    await assert.rejects(
      withResolvedScope(
        db,
        { clientId: "other-client", adAccountId: "account-1" },
        { task: "ADVERTISE", permission: "ads_read" },
        async () => {
          called = true;
        },
      ),
      /Scope is not authorized/,
    );
    assert.equal(called, false);
    assert.throws(
      () => resolveScope(db, { clientId: "client-1", adAccountId: "account-1" }, { task: "MANAGE", permission: "ads_read" }),
      /Scope is not authorized/,
    );
  } finally {
    db.close();
  }
});

test("scope resolution rejects unvalidated, revoked, and retired credential bindings", () => {
  const cases = [
    "UPDATE encrypted_credentials SET validated_at = NULL",
    "UPDATE encrypted_credentials SET revoked_at = '2026-08-19T13:00:00.000Z'",
    "UPDATE encrypted_credentials SET status = 'revoked'",
    "UPDATE integration_generations SET retired_at = '2026-08-19T13:00:00.000Z'",
    "UPDATE integration_generations SET status = 'retired'",
    "UPDATE integrations SET active = 0",
  ];
  for (const statement of cases) {
    const db = openDatabase(":memory:");
    try {
      seedAuthorizedScope(db);
      db.exec(statement);
      assert.throws(
        () => resolveScope(db, { clientId: "client-1", adAccountId: "account-1" }),
        /Scope is not authorized/,
      );
    } finally {
      db.close();
    }
  }
});

function validAudit(): AuditEvent {
  return {
    actor: "openclaw:owner-1",
    clientId: "client-1",
    adAccountId: "account-1",
    generationId: "generation-1",
    operation: "list_campaigns",
    correlationId: "request-1234",
    occurredAt: "2026-08-19T12:00:00.000Z",
    outcome: "failed",
    evidence: { externalRequestId: "meta-request-1", errorCode: "rate_limited", httpStatus: 429 },
  };
}

test("audit evidence rejects nested, serialized, typed, unknown, and secret-shaped input", () => {
  const db = openDatabase(":memory:");
  try {
    seedAuthorizedScope(db);
    const authorization = "Bearer AUDIT-AUTH-CANARY-14f2";
    const attacks: unknown[] = [
      { externalRequestId: { authorization } },
      { externalRequestId: JSON.stringify({ authorization }) },
      { externalRequestId: authorization },
      { externalRequestId: "line\nbreak" },
      { errorCode: ["access_token"] },
      { errorCode: "access_token=secret" },
      { httpStatus: "429" },
      { retryAfter: { nested: authorization } },
      { unknown: authorization },
    ];
    for (const evidence of attacks) {
      assert.throws(() => appendAudit(db, { ...validAudit(), evidence } as AuditEvent), /Invalid audit evidence/);
    }
    assert.equal(db.prepare("SELECT count(*) AS count FROM audit_log").get()!.count, 0);

    const id = appendAudit(db, validAudit());
    assert.deepEqual(JSON.parse(String(db.prepare("SELECT evidence FROM audit_log WHERE id = ?").get(id)!.evidence)), {
      externalRequestId: "meta-request-1",
      errorCode: "rate_limited",
      httpStatus: 429,
    });
  } finally {
    db.close();
  }
});

test("audit schema enforces required metadata, legal outcomes, and complete owned scope", () => {
  const db = openDatabase(":memory:");
  try {
    seedAuthorizedScope(db);
    const insert = db.prepare(`
      INSERT INTO audit_log
        (id, actor, client_id, ad_account_id, generation_id, logical_operation, correlation_id, occurred_at, outcome, evidence)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '{}')
    `);
    const valid = ["audit-1", "owner", "client-1", "account-1", "generation-1", "read", "request-1", "2026-08-19T12:00:00.000Z", "failed"];
    for (const [index, replacement] of [
      [1, ""],
      [5, ""],
      [6, ""],
      [7, "not-a-time"],
      [8, "anything"],
    ] as const) {
      const values = [...valid];
      values[index] = replacement;
      assert.throws(() => insert.run(...values));
    }
    assert.throws(() => insert.run("audit-partial", "owner", "client-1", null, null, "read", "request-2", valid[7]!, "failed"));
    assert.throws(() => insert.run("audit-orphan", "owner", "client-1", "account-1", "missing", "read", "request-3", valid[7]!, "failed"));

    const id = appendAudit(db, validAudit());
    assert.throws(() => db.prepare("UPDATE audit_log SET outcome = 'succeeded' WHERE id = ?").run(id), /immutable/);
    assert.throws(() => db.prepare("DELETE FROM audit_log WHERE id = ?").run(id), /immutable/);
  } finally {
    db.close();
  }
});

test("current Unit 2 canaries are confined across executed child, crypto, audit, scope, DB, and WAL paths", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "fb-marketing-server-canaries-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "state.sqlite");
  const db = openDatabase(path, root);
  seedAuthorizedScope(db);

  const canaries = {
    token: "TOKEN-CANARY-83ac",
    appSecret: "APP-SECRET-CANARY-41bd",
    serviceCredential: "SERVICE-CREDENTIAL-CANARY-71ce",
    key: Buffer.from("ENCRYPTION-KEY-CANARY-09df123456").toString("base64"),
    authorization: "Bearer AUTHORIZATION-CANARY-52ea",
  };
  const executed = { crypto: false, child: false, audit: false, scope: false };

  const secrets = new FakeSecrets();
  await secrets.create("database-key", canaries.key);
  const encrypted = await encryptCredential(secrets, "database-key", identity, canaries.token);
  executed.crypto = true;
  db.prepare("UPDATE encrypted_credentials SET envelope_version = ?, ciphertext = ?, iv = ?, auth_tag = ? WHERE id = ?").run(
    encrypted.version,
    encrypted.ciphertext,
    encrypted.iv,
    encrypted.tag,
    identity.credentialId,
  );

  const failingChild = new MacOSKeychainSecretProvider("fb-marketing-server", async () => {
    executed.child = true;
    throw new Error(`child ${canaries.serviceCredential}`);
  });
  let childFailure: unknown;
  try {
    await failingChild.create("service-token", canaries.serviceCredential);
  } catch (error) {
    childFailure = error;
  }

  for (const evidence of [
    { externalRequestId: { authorization: canaries.authorization } },
    { errorCode: JSON.stringify({ app_secret: canaries.appSecret }) },
  ]) {
    try {
      appendAudit(db, { ...validAudit(), evidence } as AuditEvent);
    } catch (error) {
      executed.audit = true;
      assert.equal(serializedError(error).includes(canaries.authorization), false);
      assert.equal(serializedError(error).includes(canaries.appSecret), false);
    }
  }

  let scopeFailure: unknown;
  try {
    resolveScope(db, { clientId: canaries.authorization, adAccountId: canaries.appSecret });
  } catch (error) {
    executed.scope = true;
    scopeFailure = error;
  }

  assert.deepEqual(executed, { crypto: true, child: true, audit: true, scope: true });
  const outputs = [serializedError(childFailure), serializedError(scopeFailure), JSON.stringify(encrypted)];
  db.exec("PRAGMA wal_checkpoint(PASSIVE)");
  const persisted = [await readFile(path), await readFile(`${path}-wal`)].map((value) => value.toString("latin1"));
  for (const canary of Object.values(canaries)) {
    for (const surface of [...outputs, ...persisted]) assert.equal(surface.includes(canary), false);
  }
  db.close();
});
