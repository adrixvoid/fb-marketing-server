import assert from "node:assert/strict";
import { lstatSync } from "node:fs";
import { chmod, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { backupDatabase, openDatabase, restoreDatabase, transaction } from "../src/db.js";
import { migrations, runMigrations, type Migration } from "../src/migrations.js";

const unitFiveAt = "2026-08-19T12:00:00.000Z";

function seedV5UpdateExecution(db: DatabaseSync, audited: boolean): string {
  const hash = "0".repeat(64);
  const result = `{ "next_action":"no_action", "completed_at":"${unitFiveAt}", "status":"succeeded" }`;
  db.exec(`
    INSERT INTO clients VALUES ('c1', 'Client', 'p1', 1);
    INSERT INTO integrations VALUES ('i1', 'App', 'app1', 'active', 1);
    INSERT INTO integration_generations (id, integration_id, generation, status, validated_at) VALUES ('g1', 'i1', '1', 'active', '${unitFiveAt}');
    INSERT INTO ad_accounts (id, client_id, name, currency, timezone) VALUES ('a1', 'c1', 'Account', 'USD', 'UTC');
    INSERT INTO scope_mappings VALUES ('c1', 'a1', 'g1', 1, 1, 1, 1, 1, '["ADVERTISE"]');
    INSERT INTO encrypted_credentials (id, generation_id, subject_id, key_ref, envelope_version, ciphertext, iv, auth_tag, scopes, status, validated_at)
      VALUES ('credential', 'g1', 'subject', 'key', 1, 'cipher', 'iv', 'tag', '["ads_management"]', 'active', '${unitFiveAt}');
    INSERT INTO operations (id, actor, client_id, ad_account_id, generation_id, operation_type, payload_json, payload_hash, status, created_at, expires_at)
      VALUES ('op1', 'owner', 'c1', 'a1', 'g1', 'update_object', '{}', '${hash}', 'pending', '${unitFiveAt}', '2026-08-20T00:00:00.000Z');
    INSERT INTO proof_nonces (nonce, owner_identity, operation_id, decision, body_hash, issued_at, consumed_at, correlation_id, purge_after)
      VALUES ('AAAAAAAAAAAAAAAAAAAAAA', 'discord:owner', 'op1', 'approved', '${hash}', 1, '${unitFiveAt}', 'approval-request', 301);
    INSERT INTO approval_decisions (id, operation_id, payload_hash, decision, owner_identity, decided_at, nonce, correlation_id)
      VALUES ('decision1', 'op1', '${hash}', 'approved', 'discord:owner', '${unitFiveAt}', 'AAAAAAAAAAAAAAAAAAAAAA', 'approval-request');
    INSERT INTO operation_executions (id, operation_id, decision_id, payload_hash, status, claimed_at, correlation_id)
      VALUES ('execution1', 'op1', 'decision1', '${hash}', 'running', '${unitFiveAt}', 'execution-request');
    UPDATE operations SET status = 'executing' WHERE id = 'op1';
    INSERT INTO operation_steps (execution_id, operation_id, step_key, sequence, kind, status, request_hash, correlation_id, attempted_at)
      VALUES ('execution1', 'op1', 'update_object', 0, 'update_object', 'intent', '${hash}', 'original-step-request', '${unitFiveAt}');
    UPDATE operation_steps SET status = 'succeeded', external_id = 'campaign-1', completed_at = '${unitFiveAt}' WHERE execution_id = 'execution1';
    UPDATE operation_executions SET status = 'succeeded', completed_at = '${unitFiveAt}' WHERE id = 'execution1';
    UPDATE operations SET status = 'succeeded', result_json = '${result}' WHERE id = 'op1';
  `);
  if (audited) db.exec(`
    INSERT INTO audit_log (id, actor, client_id, ad_account_id, generation_id, logical_operation, correlation_id, occurred_at, outcome, evidence)
      VALUES ('legacy-intent', 'discord:owner', 'c1', 'a1', 'g1', 'execute_update_object', 'original-step-request', '${unitFiveAt}', 'started', '{}');
    INSERT INTO audit_log (id, actor, client_id, ad_account_id, generation_id, logical_operation, correlation_id, occurred_at, outcome, evidence)
      VALUES ('legacy-outcome', 'discord:owner', 'c1', 'a1', 'g1', 'execute_update_object', 'original-step-request', '${unitFiveAt}', 'succeeded', '{}');
    INSERT INTO operation_execution_audit_links (audit_id, operation_id, decision_id, execution_id, step_key, event_type)
      VALUES ('legacy-intent', 'op1', 'decision1', 'execution1', 'update_object', 'meta_call');
    INSERT INTO operation_execution_audit_links (audit_id, operation_id, decision_id, execution_id, step_key, event_type)
      VALUES ('legacy-outcome', 'op1', 'decision1', 'execution1', 'update_object', 'meta_call');
  `);
  return result;
}

test("Unit 5 remediation schema upgrades through v8 and remains idempotent with foreign keys", () => {
  const db = openDatabase(":memory:");
  try {
    runMigrations(db);
    runMigrations(db);

    assert.equal(db.prepare("PRAGMA user_version").get()!.user_version, 8);
    assert.deepEqual(
      db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({ name }) => name),
      [
        "ad_accounts",
        "approval_decisions",
        "approval_nonce_maintenance",
        "approval_rate_limits",
        "audit_log",
        "budgets",
        "clients",
        "encrypted_credentials",
        "integration_generations",
        "integrations",
        "operation_audit_links",
        "operation_execution_audit_links",
        "operation_executions",
        "operation_idempotency",
        "operation_media",
        "operation_steps",
        "operations",
        "proof_nonces",
        "scope_mappings",
        "staged_media",
      ],
    );
    assert.deepEqual(db.prepare("SELECT name, [notnull] FROM pragma_table_info('operation_steps') WHERE name IN ('kind','step_key') ORDER BY name").all().map((row) => ({ ...row })), [
      { name: "kind", notnull: 1 }, { name: "step_key", notnull: 1 },
    ]);
    assert.throws(() =>
      db.prepare("INSERT INTO ad_accounts (id, client_id, name) VALUES (?, ?, ?)").run("act-orphan", "missing", "Orphan"),
    );
  } finally {
    db.close();
  }
});

test("upgrades an existing migration-v2 database through Unit 5 remediation", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("PRAGMA foreign_keys = ON");
    runMigrations(db, migrations.slice(0, 2));
    assert.equal(db.prepare("PRAGMA user_version").get()!.user_version, 2);
    runMigrations(db);
    assert.equal(db.prepare("PRAGMA user_version").get()!.user_version, 8);
    assert.ok(db.prepare("SELECT name FROM sqlite_schema WHERE type = 'trigger' AND name = 'operation_idempotency_identity_insert'").get());
    assert.ok(db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'approval_rate_limits'").get());
    assert.ok(db.prepare("SELECT name FROM pragma_table_info('proof_nonces') WHERE name = 'purge_after'").get());
  } finally {
    db.close();
  }
});

test("migration-v6 fails closed on forged incomplete v5 execution history", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("PRAGMA foreign_keys = ON");
    runMigrations(db, migrations.slice(0, 5));
    const at = "2026-08-19T12:00:00.000Z";
    const hash = "0".repeat(64);
    db.exec(`
      INSERT INTO clients VALUES ('c1', 'Client', 'p1', 1);
      INSERT INTO integrations VALUES ('i1', 'App', 'app1', 'active', 1);
      INSERT INTO integration_generations (id, integration_id, generation, status, validated_at) VALUES ('g1', 'i1', '1', 'active', '${at}');
      INSERT INTO ad_accounts (id, client_id, name, currency, timezone) VALUES ('a1', 'c1', 'Account', 'USD', 'UTC');
      INSERT INTO scope_mappings VALUES ('c1', 'a1', 'g1', 1, 1, 1, 1, 1, '["ADVERTISE"]');
      INSERT INTO encrypted_credentials (id, generation_id, subject_id, key_ref, envelope_version, ciphertext, iv, auth_tag, scopes, status, validated_at)
        VALUES ('credential', 'g1', 'subject', 'key', 1, 'cipher', 'iv', 'tag', '["ads_management"]', 'active', '${at}');
      INSERT INTO operations (id, actor, client_id, ad_account_id, generation_id, operation_type, payload_json, payload_hash, status, created_at, expires_at)
        VALUES ('op1', 'owner', 'c1', 'a1', 'g1', 'create_campaign_bundle', '{}', '${hash}', 'pending', '${at}', '2026-08-20T00:00:00.000Z');
      INSERT INTO proof_nonces (nonce, owner_identity, operation_id, decision, body_hash, issued_at, consumed_at, correlation_id, purge_after)
        VALUES ('AAAAAAAAAAAAAAAAAAAAAA', 'discord:owner', 'op1', 'approved', '${hash}', 1, '${at}', 'request-forged', 301);
      INSERT INTO approval_decisions (id, operation_id, payload_hash, decision, owner_identity, decided_at, nonce, correlation_id)
        VALUES ('decision1', 'op1', '${hash}', 'approved', 'discord:owner', '${at}', 'AAAAAAAAAAAAAAAAAAAAAA', 'request-forged');
      INSERT INTO operation_executions (id, operation_id, decision_id, payload_hash, status, claimed_at, correlation_id)
        VALUES ('execution1', 'op1', 'decision1', '${hash}', 'running', '${at}', 'request-forged');
      UPDATE operations SET status = 'executing' WHERE id = 'op1';
      INSERT INTO operation_steps (execution_id, operation_id, step_key, sequence, kind, status, request_hash, correlation_id, attempted_at)
        VALUES ('execution1', 'op1', 'ad', 4, 'ad', 'intent', '${hash}', 'step-forged', '${at}');
      UPDATE operation_steps SET status = 'succeeded', external_id = 'ad1', completed_at = '${at}' WHERE execution_id = 'execution1';
      UPDATE operation_executions SET status = 'succeeded', completed_at = '${at}' WHERE id = 'execution1';
      UPDATE operations SET status = 'succeeded', result_json = '{}' WHERE id = 'op1';
    `);

    assert.throws(() => runMigrations(db), /Existing Unit 5 invariant violation/);
    assert.equal(db.prepare("PRAGMA user_version").get()!.user_version, 5);
  } finally {
    db.close();
  }
});

test("migration-v6 rejects every terminal v5 operation without an execution", () => {
  for (const status of ["succeeded", "failed"] as const) {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec("PRAGMA foreign_keys = ON");
      runMigrations(db, migrations.slice(0, 5));
      const result = status === "succeeded"
        ? { status, completed_at: unitFiveAt, next_action: "no_action" }
        : { status, completed_at: unitFiveAt, failure_code: "meta_error", proven_resources: [], failed_or_ambiguous_step: null, next_action: "fix_input" };
      db.exec(`
        INSERT INTO clients VALUES ('c1', 'Client', 'p1', 1);
        INSERT INTO integrations VALUES ('i1', 'App', 'app1', 'active', 1);
        INSERT INTO integration_generations (id, integration_id, generation, status, validated_at) VALUES ('g1', 'i1', '1', 'active', '${unitFiveAt}');
        INSERT INTO ad_accounts (id, client_id, name, currency, timezone) VALUES ('a1', 'c1', 'Account', 'USD', 'UTC');
        INSERT INTO scope_mappings VALUES ('c1', 'a1', 'g1', 1, 1, 1, 1, 1, '["ADVERTISE"]');
      `);
      db.prepare(`INSERT INTO operations
        (id, actor, client_id, ad_account_id, generation_id, operation_type, payload_json, payload_hash, status, result_json, created_at, expires_at)
        VALUES ('op1', 'owner', 'c1', 'a1', 'g1', 'update_object', '{}', ?, ?, ?, ?, '2026-08-20T00:00:00.000Z')`)
        .run("0".repeat(64), status, JSON.stringify(result), unitFiveAt);

      assert.throws(() => runMigrations(db), /Existing Unit 5 invariant violation/);
      assert.equal(db.prepare("PRAGMA user_version").get()!.user_version, 5);
      assert.equal(db.prepare("SELECT status FROM operations WHERE id = 'op1'").get()!.status, status);
    } finally {
      db.close();
    }
  }
});

test("migration-v6 preserves exact audited v5 result bytes and step correlation", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("PRAGMA foreign_keys = ON");
    runMigrations(db, migrations.slice(0, 5));
    const result = seedV5UpdateExecution(db, true);
    runMigrations(db, migrations.slice(0, 6));
    assert.equal(db.prepare("SELECT result_json FROM operations WHERE id = 'op1'").get()!.result_json, result);
    assert.equal(db.prepare("SELECT correlation_id FROM operation_steps WHERE execution_id = 'execution1'").get()!.correlation_id, "original-step-request");
    assert.deepEqual(db.prepare("SELECT audit_id FROM operation_execution_audit_links WHERE step_key = 'update_object' ORDER BY audit_id").all().map(({ audit_id }) => String(audit_id)), ["legacy-intent", "legacy-outcome"]);
    assert.throws(() => db.prepare("UPDATE operations SET result_json = '{}' WHERE id = 'op1'").run(), /immutable terminal result/i);
    assert.throws(() => db.prepare("UPDATE operation_steps SET correlation_id = 'rewritten' WHERE execution_id = 'execution1'").run(), /immutable/i);
  } finally {
    db.close();
  }
});

test("migration-v6 rejects unaudited v5 outcomes transactionally without changing evidence", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("PRAGMA foreign_keys = ON");
    runMigrations(db, migrations.slice(0, 5));
    const result = seedV5UpdateExecution(db, false);
    assert.throws(() => runMigrations(db, migrations.slice(0, 6)), /audit evidence/i);
    assert.equal(db.prepare("PRAGMA user_version").get()!.user_version, 5);
    assert.equal(db.prepare("SELECT result_json FROM operations WHERE id = 'op1'").get()!.result_json, result);
    assert.equal(db.prepare("SELECT correlation_id FROM operation_steps WHERE execution_id = 'execution1'").get()!.correlation_id, "original-step-request");
    assert.equal(db.prepare("SELECT count(*) AS count FROM audit_log").get()!.count, 0);
  } finally {
    db.close();
  }
});

test("repaired migration-v6 itself rejects a bundle step without its predecessor", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("PRAGMA foreign_keys = ON");
    runMigrations(db, migrations.slice(0, 5));
    const hash = "0".repeat(64);
    db.exec(`
      INSERT INTO clients VALUES ('c1', 'Client', 'p1', 1);
      INSERT INTO integrations VALUES ('i1', 'App', 'app1', 'active', 1);
      INSERT INTO integration_generations (id, integration_id, generation, status, validated_at) VALUES ('g1', 'i1', '1', 'active', '${unitFiveAt}');
      INSERT INTO ad_accounts (id, client_id, name, currency, timezone) VALUES ('a1', 'c1', 'Account', 'USD', 'UTC');
      INSERT INTO scope_mappings VALUES ('c1', 'a1', 'g1', 1, 1, 1, 1, 1, '["ADVERTISE"]');
      INSERT INTO operations (id, actor, client_id, ad_account_id, generation_id, operation_type, payload_json, payload_hash, status, created_at, expires_at)
        VALUES ('op1', 'owner', 'c1', 'a1', 'g1', 'create_campaign_bundle', '{}', '${hash}', 'pending', '${unitFiveAt}', '2026-08-20T00:00:00.000Z');
      INSERT INTO proof_nonces (nonce, owner_identity, operation_id, decision, body_hash, issued_at, consumed_at, correlation_id, purge_after)
        VALUES ('AAAAAAAAAAAAAAAAAAAAAA', 'discord:owner', 'op1', 'approved', '${hash}', 1, '${unitFiveAt}', 'approval-request', 301);
      INSERT INTO approval_decisions (id, operation_id, payload_hash, decision, owner_identity, decided_at, nonce, correlation_id)
        VALUES ('decision1', 'op1', '${hash}', 'approved', 'discord:owner', '${unitFiveAt}', 'AAAAAAAAAAAAAAAAAAAAAA', 'approval-request');
      INSERT INTO operation_executions (id, operation_id, decision_id, payload_hash, status, claimed_at, correlation_id)
        VALUES ('execution1', 'op1', 'decision1', '${hash}', 'running', '${unitFiveAt}', 'execution-request');
      UPDATE operations SET status = 'executing' WHERE id = 'op1';
    `);
    runMigrations(db, migrations.slice(0, 6));
    assert.equal(db.prepare("PRAGMA user_version").get()!.user_version, 6);
    assert.throws(() => db.prepare(`INSERT INTO operation_steps
      (execution_id, operation_id, step_key, sequence, kind, status, request_hash, correlation_id, attempted_at)
      VALUES ('execution1', 'op1', 'ad', 4, 'ad', 'intent', ?, 'step-request', ?)`).run(hash, unitFiveAt), /predecessor|order/i);
  } finally {
    db.close();
  }
});

test("migration-v7 preserves compatible v6 evidence and rejects audit-link corruption", () => {
  const compatible = new DatabaseSync(":memory:");
  try {
    compatible.exec("PRAGMA foreign_keys = ON");
    runMigrations(compatible, migrations.slice(0, 5));
    seedV5UpdateExecution(compatible, true);
    runMigrations(compatible, migrations.slice(0, 7));
    assert.equal(compatible.prepare("PRAGMA user_version").get()!.user_version, 7);
    const before = compatible.prepare("SELECT result_json FROM operations WHERE id = 'op1'").get()!.result_json;
    const beforeLinks = compatible.prepare("SELECT count(*) AS count FROM operation_execution_audit_links WHERE operation_id = 'op1'").get()!.count;
    runMigrations(compatible);
    assert.equal(compatible.prepare("PRAGMA user_version").get()!.user_version, 8);
    assert.equal(compatible.prepare("SELECT result_json FROM operations WHERE id = 'op1'").get()!.result_json, before);
    assert.equal(compatible.prepare("SELECT correlation_id FROM operation_steps WHERE execution_id = 'execution1'").get()!.correlation_id, "original-step-request");
    assert.equal(compatible.prepare("SELECT count(*) AS count FROM operation_execution_audit_links WHERE operation_id = 'op1'").get()!.count, beforeLinks);
    assert.throws(() => compatible.prepare("UPDATE operations SET result_json = '{}' WHERE id = 'op1'").run(), /immutable terminal result/i);
  } finally {
    compatible.close();
  }

  const corrupted = new DatabaseSync(":memory:");
  try {
    corrupted.exec("PRAGMA foreign_keys = ON");
    runMigrations(corrupted, migrations.slice(0, 5));
    const result = seedV5UpdateExecution(corrupted, true);
    runMigrations(corrupted, migrations.slice(0, 6));
    corrupted.exec("DROP TRIGGER operation_execution_audit_links_no_delete; DELETE FROM operation_execution_audit_links WHERE step_key = 'update_object';");
    assert.throws(() => runMigrations(corrupted), /audit evidence/i);
    assert.equal(corrupted.prepare("PRAGMA user_version").get()!.user_version, 6);
    assert.equal(corrupted.prepare("SELECT result_json FROM operations WHERE id = 'op1'").get()!.result_json, result);
  } finally {
    corrupted.close();
  }
});

test("migration-v8 rejects nullable v7 step audit links and rolls back without changing evidence", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("PRAGMA foreign_keys = ON");
    runMigrations(db, migrations.slice(0, 5));
    const result = seedV5UpdateExecution(db, true);
    runMigrations(db, migrations.slice(0, 7));
    db.exec(`
      PRAGMA ignore_check_constraints = ON;
      INSERT INTO audit_log (id, actor, client_id, ad_account_id, generation_id, logical_operation, correlation_id, occurred_at, outcome, evidence)
        VALUES ('nullable-step-audit', 'discord:owner', 'c1', 'a1', 'g1', 'execute_update_object', 'nullable-step-request', '${unitFiveAt}', 'started', '{}');
      INSERT INTO operation_execution_audit_links (audit_id, operation_id, decision_id, execution_id, step_key, event_type)
        VALUES ('nullable-step-audit', 'op1', 'decision1', 'execution1', NULL, 'meta_call');
      PRAGMA ignore_check_constraints = OFF;
    `);
    const beforeLinks = db.prepare("SELECT count(*) AS count FROM operation_execution_audit_links").get()!.count;

    assert.throws(() => runMigrations(db), /step audit link|Unit 5/i);
    assert.equal(db.prepare("PRAGMA user_version").get()!.user_version, 7);
    assert.equal(db.prepare("SELECT result_json FROM operations WHERE id = 'op1'").get()!.result_json, result);
    assert.equal(db.prepare("SELECT correlation_id FROM operation_steps WHERE execution_id = 'execution1'").get()!.correlation_id, "original-step-request");
    assert.equal(db.prepare("SELECT count(*) AS count FROM operation_execution_audit_links").get()!.count, beforeLinks);
  } finally {
    db.close();
  }
});

test("migration-v8 rejects forged v7 failed-resource evidence without rewriting history", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("PRAGMA foreign_keys = ON");
    runMigrations(db, migrations.slice(0, 5));
    seedV5UpdateExecution(db, true);
    runMigrations(db, migrations.slice(0, 7));
    const hash = "1".repeat(64);
    const result = `{ "status":"failed", "completed_at":"${unitFiveAt}", "failure_code":"meta_error", "proven_resources":[{"type":"object","id":"forged"}], "failed_or_ambiguous_step":null, "next_action":"fix_input" }`;
    db.exec(`
      INSERT INTO operations (id, actor, client_id, ad_account_id, generation_id, operation_type, payload_json, payload_hash, status, created_at, expires_at)
        VALUES ('op2', 'owner', 'c1', 'a1', 'g1', 'update_object', '{}', '${hash}', 'pending', '${unitFiveAt}', '2026-08-20T00:00:00.000Z');
      INSERT INTO proof_nonces (nonce, owner_identity, operation_id, decision, body_hash, issued_at, consumed_at, correlation_id, purge_after)
        VALUES ('BBBBBBBBBBBBBBBBBBBBBB', 'discord:owner', 'op2', 'approved', '${hash}', 2, '${unitFiveAt}', 'approval-op2', 302);
      INSERT INTO approval_decisions (id, operation_id, payload_hash, decision, owner_identity, decided_at, nonce, correlation_id)
        VALUES ('decision2', 'op2', '${hash}', 'approved', 'discord:owner', '${unitFiveAt}', 'BBBBBBBBBBBBBBBBBBBBBB', 'approval-op2');
      INSERT INTO operation_executions (id, operation_id, decision_id, payload_hash, status, claimed_at, correlation_id)
        VALUES ('execution2', 'op2', 'decision2', '${hash}', 'running', '${unitFiveAt}', 'execution-op2');
      UPDATE operations SET status = 'executing' WHERE id = 'op2';
      INSERT INTO operation_steps (execution_id, operation_id, step_key, sequence, kind, status, request_hash, correlation_id, attempted_at)
        VALUES ('execution2', 'op2', 'update_object', 0, 'update_object', 'intent', '${hash}', 'step-op2', '${unitFiveAt}');
      UPDATE operation_steps SET status = 'succeeded', external_id = 'campaign-real', completed_at = '${unitFiveAt}' WHERE execution_id = 'execution2';
      DROP TRIGGER operation_terminal_validate;
      UPDATE operations SET status = 'failed', result_json = '${result}' WHERE id = 'op2';
    `);
    const auditCount = db.prepare("SELECT count(*) AS count FROM operation_execution_audit_links WHERE operation_id = 'op2'").get()!.count;

    assert.throws(() => runMigrations(db), /Existing Unit 5 invariant violation/);
    assert.equal(db.prepare("PRAGMA user_version").get()!.user_version, 7);
    assert.equal(db.prepare("SELECT result_json FROM operations WHERE id = 'op2'").get()!.result_json, result);
    assert.equal(db.prepare("SELECT correlation_id FROM operation_steps WHERE execution_id = 'execution2'").get()!.correlation_id, "step-op2");
    assert.equal(db.prepare("SELECT count(*) AS count FROM operation_execution_audit_links WHERE operation_id = 'op2'").get()!.count, auditCount);
  } finally {
    db.close();
  }
});

test("migration-v3 rejects existing v2 rows that violate Unit 4 invariants", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("PRAGMA foreign_keys = ON");
    runMigrations(db, migrations.slice(0, 2));
    db.exec(`
      INSERT INTO clients (id, name, portfolio_id) VALUES ('c1', 'One', 'p1');
      INSERT INTO integrations (id, name, meta_app_id, state) VALUES ('i1', 'App', 'app1', 'active');
      INSERT INTO integration_generations (id, integration_id, generation, status) VALUES ('g1', 'i1', '1', 'active');
      INSERT INTO ad_accounts (id, client_id, name) VALUES ('a1', 'c1', 'Account');
      INSERT INTO scope_mappings (client_id, ad_account_id, generation_id) VALUES ('c1', 'a1', 'g1');
      PRAGMA ignore_check_constraints = ON;
      INSERT INTO operations
        (id, actor, client_id, ad_account_id, generation_id, operation_type, payload_json, payload_hash,
         status, created_at, expires_at)
      VALUES ('bad', 'actor', 'c1', 'a1', 'g1', 'configure_monthly_budget', '{}', '${"0".repeat(64)}',
        'pending', '2026-08-19T12:00:00.000Z', '2026-08-19T23:59:59.999Z');
      PRAGMA ignore_check_constraints = OFF;
    `);
    assert.throws(() => runMigrations(db), /existing Unit 4 invariant/i);
    assert.equal(db.prepare("PRAGMA user_version").get()!.user_version, 2);
  } finally {
    db.close();
  }
});

test("migration-v4 preserves existing nonce, decision, and linked audit evidence", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("PRAGMA foreign_keys = ON");
    runMigrations(db, migrations.slice(0, 3));
    db.exec(`
      INSERT INTO clients (id, name, portfolio_id) VALUES ('c1', 'One', 'p1');
      INSERT INTO integrations (id, name, meta_app_id, state) VALUES ('i1', 'App', 'app1', 'active');
      INSERT INTO integration_generations (id, integration_id, generation, status) VALUES ('g1', 'i1', '1', 'active');
      INSERT INTO ad_accounts (id, client_id, name) VALUES ('a1', 'c1', 'Account');
      INSERT INTO scope_mappings (client_id, ad_account_id, generation_id) VALUES ('c1', 'a1', 'g1');
      INSERT INTO operations
        (id, actor, client_id, ad_account_id, generation_id, operation_type, payload_json, payload_hash, status, created_at, expires_at)
        VALUES ('op1', 'actor', 'c1', 'a1', 'g1', 'configure_monthly_budget', '{}', '${"0".repeat(64)}', 'pending',
          '2026-08-19T12:00:00.000Z', '2026-08-20T00:00:00.000Z');
      INSERT INTO proof_nonces
        (nonce, owner_identity, operation_id, decision, body_hash, issued_at, consumed_at, correlation_id)
        VALUES ('AAAAAAAAAAAAAAAAAAAAAA', 'discord:owner', 'op1', 'approved', '${"1".repeat(64)}', 1000,
          '2026-08-19T12:00:00.000Z', 'request-1');
      INSERT INTO approval_decisions
        (id, operation_id, payload_hash, decision, owner_identity, decided_at, nonce, correlation_id)
        VALUES ('decision-1', 'op1', '${"0".repeat(64)}', 'approved', 'discord:owner',
          '2026-08-19T12:00:00.000Z', 'AAAAAAAAAAAAAAAAAAAAAA', 'request-1');
      INSERT INTO audit_log
        (id, actor, client_id, ad_account_id, generation_id, logical_operation, correlation_id, occurred_at, outcome, evidence)
        VALUES ('audit-1', 'discord:owner', 'c1', 'a1', 'g1', 'approve_operation', 'request-1',
          '2026-08-19T12:00:00.000Z', 'succeeded', '{}');
      INSERT INTO operation_audit_links (audit_id, operation_id, decision_id, event_type)
        VALUES ('audit-1', 'op1', 'decision-1', 'decision');
    `);
    runMigrations(db);
    assert.equal(db.prepare("PRAGMA user_version").get()!.user_version, 8);
    assert.deepEqual({ ...db.prepare(`SELECT n.purge_after, d.id AS decision_id, l.audit_id
      FROM proof_nonces n JOIN approval_decisions d ON d.nonce = n.nonce
      JOIN operation_audit_links l ON l.decision_id = d.id`).get() }, {
      purge_after: 1300,
      decision_id: "decision-1",
      audit_id: "audit-1",
    });
    assert.throws(() => db.prepare("DELETE FROM proof_nonces WHERE nonce = 'AAAAAAAAAAAAAAAAAAAAAA'").run(), /decision evidence/);
    db.prepare(`INSERT INTO approval_rate_limits
      (scope, identity, window_started_at, admitted_count, rejected_count) VALUES ('owner', 'discord:owner', 1, 1, 0)`).run();
    assert.throws(() => db.prepare(`INSERT INTO approval_rate_limits
      (scope, identity, window_started_at, admitted_count, rejected_count) VALUES ('owner', 'discord:other', 1, 1, 0)`).run(), /unique/i);
    assert.throws(() => db.prepare("DELETE FROM approval_rate_limits").run(), /durable/);
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
      version: 9,
      up(database) {
        database.exec("CREATE TABLE migration_canary (id TEXT PRIMARY KEY)");
        throw new Error("interrupted");
      },
    };

    assert.throws(() => runMigrations(db, [broken]), /interrupted/);
    assert.equal(db.prepare("PRAGMA user_version").get()!.user_version, 8);
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
