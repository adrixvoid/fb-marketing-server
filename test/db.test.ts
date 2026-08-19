import assert from "node:assert/strict";
import { lstatSync } from "node:fs";
import { chmod, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { backupDatabase, openDatabase, restoreDatabase, transaction } from "../src/db.js";
import { runMigrations, type Migration } from "../src/migrations.js";

test("migration v2 adds only Unit 4 state and remains idempotent with foreign keys", () => {
  const db = openDatabase(":memory:");
  try {
    runMigrations(db);
    runMigrations(db);

    assert.equal(db.prepare("PRAGMA user_version").get()!.user_version, 2);
    assert.deepEqual(
      db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({ name }) => name),
      [
        "ad_accounts",
        "approval_decisions",
        "audit_log",
        "budgets",
        "clients",
        "encrypted_credentials",
        "integration_generations",
        "integrations",
        "operation_audit_links",
        "operation_idempotency",
        "operation_media",
        "operations",
        "proof_nonces",
        "scope_mappings",
        "staged_media",
      ],
    );
    assert.throws(() =>
      db.prepare("INSERT INTO ad_accounts (id, client_id, name) VALUES (?, ?, ?)").run("act-orphan", "missing", "Orphan"),
    );
  } finally {
    db.close();
  }
});

test("migrations reject unsupported database versions", () => {
  for (const version of [-1, 99]) {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec(`PRAGMA user_version = ${version}`);
      assert.throws(() => runMigrations(db), /Unsupported database version/);
    } finally {
      db.close();
    }
  }
});

test("failed file initialization closes SQLite resources", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "fb-marketing-server-open-failure-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "newer.sqlite");
  const newer = new DatabaseSync(path);
  newer.exec("PRAGMA user_version = 99");
  newer.close();
  await chmod(path, 0o600);

  const before = (await readdir("/dev/fd")).length;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    assert.throws(() => openDatabase(path, root), /Unsupported database version/);
  }
  await new Promise((resolve) => setImmediate(resolve));
  const after = (await readdir("/dev/fd")).length;
  assert.ok(after - before <= 6, `file descriptors grew by ${after - before}`);
});

test("failed migrations and synchronous transactions roll back completely", () => {
  const db = openDatabase(":memory:");
  try {
    const broken: Migration = {
      version: 3,
      up(database) {
        database.exec("CREATE TABLE migration_canary (id TEXT PRIMARY KEY)");
        throw new Error("interrupted");
      },
    };

    assert.throws(() => runMigrations(db, [broken]), /interrupted/);
    assert.equal(db.prepare("PRAGMA user_version").get()!.user_version, 2);
    assert.equal(db.prepare("SELECT name FROM sqlite_schema WHERE name = 'migration_canary'").get(), undefined);

    assert.throws(() =>
      transaction(db, () => {
        db.prepare("INSERT INTO clients (id, name, portfolio_id) VALUES (?, ?, ?)").run(
          "client-rollback",
          "Rollback",
          "portfolio-rollback",
        );
        throw new Error("process stopped");
      }),
    );
    assert.equal(db.prepare("SELECT id FROM clients WHERE id = ?").get("client-rollback"), undefined);
  } finally {
    db.close();
  }
});

test("transaction rejects promise-like callbacks and rolls back their synchronous writes", async () => {
  const db = openDatabase(":memory:");
  try {
    let failure: unknown;
    try {
      // @ts-expect-error Transaction callbacks are intentionally synchronous-only.
      await transaction(db, () => {
        db.prepare("INSERT INTO clients (id, name, portfolio_id) VALUES (?, ?, ?)").run(
          "client-async",
          "Async",
          "portfolio-async",
        );
        return Promise.resolve("not-supported");
      });
    } catch (error) {
      failure = error;
    }
    assert.match(String(failure), /Transaction callback must be synchronous/);
    assert.equal(db.prepare("SELECT id FROM clients WHERE id = ?").get("client-async"), undefined);
  } finally {
    db.close();
  }
});

test("composite ownership prevents cross-client scope mappings", () => {
  const db = openDatabase(":memory:");
  try {
    db.exec(`
      INSERT INTO clients (id, name, portfolio_id) VALUES ('c1', 'One', 'p1'), ('c2', 'Two', 'p2');
      INSERT INTO integrations (id, name, meta_app_id, state) VALUES ('i1', 'App', 'app1', 'active');
      INSERT INTO integration_generations (id, integration_id, generation, status, validated_at)
        VALUES ('g1', 'i1', 'g1', 'active', '2026-08-19T12:00:00.000Z');
      INSERT INTO ad_accounts (id, client_id, name) VALUES ('a2', 'c2', 'Account Two');
    `);
    assert.throws(() =>
      db.prepare(`
        INSERT INTO scope_mappings
          (client_id, ad_account_id, generation_id, app_authorized, subject_authorized, partner_authorized, asset_authorized)
        VALUES ('c1', 'a2', 'g1', 1, 1, 1, 1)
      `).run(),
    );
  } finally {
    db.close();
  }
});

test("budgets store exact safe minor units and match the owned account currency", () => {
  const db = openDatabase(":memory:");
  try {
    db.exec(`
      INSERT INTO clients (id, name, portfolio_id) VALUES ('c1', 'One', 'p1');
      INSERT INTO ad_accounts (id, client_id, name, currency) VALUES ('a1', 'c1', 'Account One', 'USD');
    `);
    const insert = db.prepare(`
      INSERT INTO budgets (client_id, ad_account_id, amount_minor, currency, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    const time = "2026-08-19T12:00:00.000Z";
    for (const amount of ["banana", -1, 9_007_199_254_740_992n]) {
      assert.throws(() => insert.run("c1", "a1", amount, "USD", time));
    }
    assert.throws(() => insert.run("c1", "a1", 1234, "EUR", time));

    insert.run("c1", "a1", 1234, "USD", time);
    const stored = db.prepare("SELECT amount_minor, currency FROM budgets").get()!;
    assert.equal(stored.amount_minor, 1234);
    assert.equal(stored.currency, "USD");
  } finally {
    db.close();
  }
});

test("file state survives restart and protected backup restores a usable copy", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "fb-marketing-server-db-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const live = join(root, "live.sqlite");
  const snapshot = join(root, "backup.sqlite");
  const restored = join(root, "restored.sqlite");

  let db = openDatabase(live, root);
  db.prepare("INSERT INTO clients (id, name, portfolio_id) VALUES (?, ?, ?)").run(
    "client-persisted",
    "Persisted Client",
    "portfolio-1",
  );
  assert.equal(db.prepare("PRAGMA journal_mode").get()!.journal_mode, "wal");
  await backupDatabase(db, snapshot, root);
  assert.equal((await stat(snapshot)).mode & 0o777, 0o600);
  db.close();

  db = openDatabase(live, root);
  assert.equal(db.prepare("SELECT name FROM clients WHERE id = ?").get("client-persisted")!.name, "Persisted Client");
  db.close();

  await restoreDatabase(snapshot, restored, root);
  assert.equal((await stat(restored)).mode & 0o777, 0o600);
  db = openDatabase(restored, root);
  assert.equal(db.prepare("SELECT name FROM clients WHERE id = ?").get("client-persisted")!.name, "Persisted Client");
  db.close();
  assert.ok((await readFile(restored)).byteLength > 0);
});

test("backup reserves private files before writing and keeps temporary work in a private directory", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "fb-marketing-server-backup-mode-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const live = join(root, "live.sqlite");
  const snapshot = join(root, "backup.sqlite");
  const db = openDatabase(live, root);
  db.prepare("INSERT INTO clients (id, name, portfolio_id) VALUES (?, ?, ?)").run(
    "large-client",
    "x".repeat(2 * 1024 * 1024),
    "large-portfolio",
  );

  let observations = 0;
  await backupDatabase(db, snapshot, root, {
    onProgress({ temporaryDirectory, temporaryPath }) {
      observations += 1;
      assert.equal(lstatSync(temporaryDirectory).mode & 0o777, 0o700);
      assert.equal(lstatSync(temporaryPath).mode & 0o777, 0o600);
      assert.equal(lstatSync(snapshot).mode & 0o777, 0o600);
    },
  });
  db.close();
  assert.ok(observations > 0, "backup progress must expose in-flight permissions");
  assert.equal((await stat(snapshot)).mode & 0o777, 0o600);
  assert.equal((await readdir(root)).some((name) => name.startsWith(".backup-")), false);
});

test("restore rejects counterfeit and altered v2 schemas before publication", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "fb-marketing-server-schema-auth-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const tableNames = [
    "ad_accounts",
    "audit_log",
    "budgets",
    "clients",
    "encrypted_credentials",
    "integration_generations",
    "integrations",
    "scope_mappings",
    "staged_media",
  ];
  const counterfeitPath = join(root, "counterfeit.sqlite");
  const counterfeit = new DatabaseSync(counterfeitPath);
  counterfeit.exec(`${tableNames.map((name) => `CREATE TABLE ${name} (x TEXT);`).join("\n")} PRAGMA user_version = 2;`);
  counterfeit.close();
  await chmod(counterfeitPath, 0o600);
  await assert.rejects(
    restoreDatabase(counterfeitPath, join(root, "counterfeit-restored.sqlite"), root),
    /schema|fingerprint/i,
  );

  const livePath = join(root, "live.sqlite");
  const live = openDatabase(livePath, root);
  const variants = ["trigger", "index", "foreign-key"] as const;
  for (const variant of variants) await backupDatabase(live, join(root, `${variant}.sqlite`), root);
  live.close();

  const trigger = new DatabaseSync(join(root, "trigger.sqlite"));
  trigger.exec(`
    DROP TRIGGER audit_log_no_update;
    CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
    BEGIN SELECT RAISE(ABORT, 'counterfeit trigger'); END;
  `);
  trigger.close();

  const index = new DatabaseSync(join(root, "index.sqlite"));
  index.exec(`
    DROP INDEX one_active_scope_generation;
    CREATE INDEX one_active_scope_generation ON scope_mappings(client_id, ad_account_id);
  `);
  index.close();

  const foreignKey = new DatabaseSync(join(root, "foreign-key.sqlite"));
  foreignKey.exec(`
    PRAGMA foreign_keys = OFF;
    DROP TABLE ad_accounts;
    CREATE TABLE ad_accounts (
      id TEXT NOT NULL CHECK (length(trim(id)) > 0),
      client_id TEXT NOT NULL,
      name TEXT NOT NULL CHECK (length(trim(name)) > 0),
      currency TEXT,
      timezone TEXT,
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      PRIMARY KEY (id),
      UNIQUE (id, client_id),
      UNIQUE (id, client_id, currency)
    ) STRICT;
  `);
  foreignKey.close();

  for (const variant of variants) {
    const destination = join(root, `${variant}-restored.sqlite`);
    await assert.rejects(restoreDatabase(join(root, `${variant}.sqlite`), destination, root), /schema|fingerprint/i);
    await assert.rejects(stat(destination));
  }
  assert.equal((await readdir(root)).some((name) => name.startsWith(".backup-")), false);
});

test("trusted database root rejects traversal, symlinks, and existing backup targets", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "fb-marketing-server-paths-"));
  const outside = await mkdtemp(join(tmpdir(), "fb-marketing-server-outside-"));
  t.after(() => Promise.all([rm(root, { recursive: true, force: true }), rm(outside, { recursive: true, force: true })]));

  assert.throws(() => openDatabase(join(root, "..", "outside.sqlite"), root), /trusted data root/);
  const linkedRoot = join(outside, "linked-root");
  await symlink(root, linkedRoot);
  assert.throws(() => openDatabase(join(linkedRoot, "linked.sqlite"), linkedRoot), /symlink/);

  const live = join(root, "live.sqlite");
  const db = openDatabase(live, root);
  const existing = join(root, "existing.sqlite");
  await writeFile(existing, "preserve-me", { mode: 0o600 });
  await assert.rejects(backupDatabase(db, existing, root), /already exists/);
  assert.equal(await readFile(existing, "utf8"), "preserve-me");

  const outsideTarget = join(outside, "outside-target");
  await writeFile(outsideTarget, "outside", { mode: 0o600 });
  const linkedDestination = join(root, "linked-backup.sqlite");
  await symlink(outsideTarget, linkedDestination);
  await assert.rejects(backupDatabase(db, linkedDestination, root), /symlink|already exists/);
  assert.equal(await readFile(outsideTarget, "utf8"), "outside");
  await assert.rejects(backupDatabase(db, join(outside, "escaped.sqlite"), root), /trusted data root/);
  db.close();
});

test("restore rejects symlinked and corrupt sources and cleans protected temporary files", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "fb-marketing-server-restore-"));
  const outside = await mkdtemp(join(tmpdir(), "fb-marketing-server-restore-outside-"));
  t.after(() => Promise.all([rm(root, { recursive: true, force: true }), rm(outside, { recursive: true, force: true })]));

  const outsideSource = join(outside, "source.sqlite");
  const outsideDb = openDatabase(outsideSource, outside);
  outsideDb.close();
  const linkedSource = join(root, "linked-source.sqlite");
  await symlink(outsideSource, linkedSource);
  await assert.rejects(restoreDatabase(linkedSource, join(root, "linked-restored.sqlite"), root), /symlink/);

  const corrupt = join(root, "corrupt.sqlite");
  const destination = join(root, "restored.sqlite");
  await writeFile(corrupt, "not sqlite", { mode: 0o600 });
  await assert.rejects(restoreDatabase(corrupt, destination, root), /backup|integrity|schema/i);
  await assert.rejects(stat(destination));
  assert.equal((await readdir(root)).some((name) => name.includes(".tmp-")), false);
});
