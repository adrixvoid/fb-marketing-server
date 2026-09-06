import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, stat, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  migrationReport,
  parseMigrationEvidence,
  recordMigrationEvidence,
  validateMigrationManifest,
} from "../scripts/validate-migration.js";
import inventory from "./fixtures/migration-inventory.json" with { type: "json" };

const clone = () => structuredClone(inventory) as any;
const ids = { client_id: "client-pilot", business_id: "290166249089842", target_generation: "generation-central-15", old_integrations: ["old-01"] };
const at = (day: number, hour = 0) => `2026-09-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00.000Z`;

function authority(account: string) {
  return {
    app_access: true, token_valid: true, token_subject: "system_user:agency-1", partner_relationship: true,
    assigned_assets: [account], assigned_tasks: ["ADVERTISE", "MANAGE"], permissions: ["ads_read", "ads_management"],
    endpoint_authority: ["campaigns.read", "insights.read", "campaigns.write"],
  };
}

function parity() {
  return { reads_match: true, currency_match: true, timezone_match: true, pacing_match: true, variance_ratio: 0.001, tolerance_ratio: 0.01 };
}

async function pilotThrough(path: string, stage: "authority" | "parity" | "canary" | "signoff" | "freeze" | "cutover" | "observation" | "retire") {
  const manifest = validateMigrationManifest(clone());
  for (const account of ["act_pilot_a", "act_pilot_b"]) await recordMigrationEvidence(path, manifest, { type: "authority", ...ids, ad_account_id: account, at: at(1) }, authority(account));
  if (stage === "authority") return manifest;
  for (const account of ["act_pilot_a", "act_pilot_b"]) await recordMigrationEvidence(path, manifest, { type: "parity", ...ids, ad_account_id: account, at: at(1, 1) }, parity());
  if (stage === "parity") return manifest;
  await recordMigrationEvidence(path, manifest, { type: "paused_canary", ...ids, ad_account_id: "act_pilot_a", at: at(1, 2) }, {
    proposal_id: "proposal-1", owner_decision_id: "decision-1", owner_decision: "approved", operation_id: "operation-1", execution_id: "execution-1",
    operation_generation: ids.target_generation,
    resources: [{ kind: "campaign", id: "campaign-1", status: "PAUSED" }, { kind: "ad_set", id: "adset-1", status: "PAUSED" }, { kind: "ad", id: "ad-1", status: "PAUSED" }],
  });
  if (stage === "canary") return manifest;
  await recordMigrationEvidence(path, manifest, { type: "owner_signoff", ...ids, at: at(1, 3) }, { owner_identity: "discord:owner", accepted: true });
  if (stage === "signoff") return manifest;
  await recordMigrationEvidence(path, manifest, { type: "freeze_reconciliation", ...ids, at: at(1, 4) }, { mutations_frozen: true, in_flight_operations: 0, ambiguous_operations: 0, resolved_operation_ids: [] });
  if (stage === "freeze") return manifest;
  await recordMigrationEvidence(path, manifest, { type: "cutover", ...ids, at: at(1, 5) }, { route_generation: ids.target_generation, previous_integrations: ["old-01"] });
  if (stage === "cutover") return manifest;
  await recordMigrationEvidence(path, manifest, { type: "observation", ...ids, at: at(8, 5) }, { healthy: true, resources_preserved: true });
  if (stage === "observation") return manifest;
  await recordMigrationEvidence(path, manifest, { type: "retire", ...ids, at: at(8, 6) }, { retired_integrations: ["old-01"], history_preserved: true });
  return manifest;
}

test("manifest enforces exact agency/pilot inventory and one client-business-account ownership", () => {
  assert.equal(validateMigrationManifest(clone()).apps.length, 14);
  for (const mutate of [
    (x: any) => { x.agency_business_id = "wrong"; },
    (x: any) => { x.batches.reverse(); },
    (x: any) => { x.apps[1].business_id = "other-business"; },
    (x: any) => { x.apps[6].ad_account_ids = ["act_pilot_a"]; },
  ]) {
    const candidate = clone(); mutate(candidate);
    assert.equal(migrationReport(candidate, []).status, "blocked");
    assert.equal(migrationReport(candidate, []).gate, "manifest");
  }
});

test("exact evidence schemas reject unknown fields and secret keys or values before file access", async () => {
  const root = await mkdtemp(join(tmpdir(), "migration-redaction-"));
  const path = join(root, "evidence.jsonl");
  const manifest = validateMigrationManifest(clone());
  for (const response of [{ ...authority("act_pilot_a"), extra: true }, { ...authority("act_pilot_a"), note: "Authorization: Bearer canary" }, { ...authority("act_pilot_a"), access_token: "canary" }]) {
    await assert.rejects(recordMigrationEvidence(path, manifest, { type: "authority", ...ids, ad_account_id: "act_pilot_a", at: at(1) }, response), /invalid|secret/i);
    await assert.rejects(stat(path));
  }
});

test("authority, parity, paused canary, signoff, and freeze are linked ordered gates", async () => {
  const root = await mkdtemp(join(tmpdir(), "migration-gates-"));
  const path = join(root, "evidence.jsonl");
  const manifest = validateMigrationManifest(clone());
  assert.equal(migrationReport(manifest, []).gate, "authority");
  await assert.rejects(recordMigrationEvidence(path, manifest, { type: "owner_signoff", ...ids, at: at(1) }, { owner_identity: "discord:owner", accepted: true }), /prior paused canary/i);
  await pilotThrough(path, "authority");
  assert.equal(migrationReport(manifest, await parseMigrationEvidence(path, manifest)).gate, "parity");
  await recordMigrationEvidence(path, manifest, { type: "parity", ...ids, ad_account_id: "act_pilot_a", at: at(1, 1) }, { ...parity(), pacing_match: false });
  assert.equal(migrationReport(manifest, await parseMigrationEvidence(path, manifest)).gate, "parity");
  await recordMigrationEvidence(path, manifest, { type: "parity", ...ids, ad_account_id: "act_pilot_b", at: at(1, 1) }, parity());
  await recordMigrationEvidence(path, manifest, { type: "parity", ...ids, ad_account_id: "act_pilot_a", at: at(1, 2) }, parity());
  assert.equal(migrationReport(manifest, await parseMigrationEvidence(path, manifest)).gate, "paused_canary");
  await assert.rejects(recordMigrationEvidence(path, manifest, { type: "paused_canary", ...ids, ad_account_id: "act_pilot_a", at: at(1, 3) }, {
    proposal_id: "p", owner_decision_id: "d", owner_decision: "approved", operation_id: "o", execution_id: "e", operation_generation: ids.target_generation,
    resources: [{ kind: "campaign", id: "c", status: "ACTIVE" }],
  }), /PAUSED/i);
});

test("cutover requires frozen reconciled operations and exact previous integration set", async () => {
  const root = await mkdtemp(join(tmpdir(), "migration-freeze-"));
  const path = join(root, "evidence.jsonl");
  const manifest = await pilotThrough(path, "signoff");
  assert.equal(migrationReport(manifest, await parseMigrationEvidence(path, manifest)).gate, "freeze_reconciliation");
  await assert.rejects(recordMigrationEvidence(path, manifest, { type: "cutover", ...ids, at: at(1, 4) }, { route_generation: ids.target_generation, previous_integrations: ["old-01"] }), /freeze/i);
  await recordMigrationEvidence(path, manifest, { type: "freeze_reconciliation", ...ids, at: at(1, 4) }, { mutations_frozen: true, in_flight_operations: 1, ambiguous_operations: 0, resolved_operation_ids: [] });
  assert.equal(migrationReport(manifest, await parseMigrationEvidence(path, manifest)).gate, "freeze_reconciliation");
});

test("hash-chained private evidence rejects modification, reorder, truncation, modes, and symlinks", async () => {
  const root = await mkdtemp(join(tmpdir(), "migration-chain-"));
  const path = join(root, "evidence.jsonl");
  const manifest = await pilotThrough(path, "parity");
  assert.equal((await stat(root)).mode & 0o777, 0o700);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  const original = await readFile(path, "utf8");
  await writeFile(path, original.replace("act_pilot_a", "act_pilot_x"));
  await assert.rejects(parseMigrationEvidence(path, manifest), /integrity/i);
  await writeFile(path, original); await chmod(path, 0o644);
  await assert.rejects(parseMigrationEvidence(path, manifest), /private/i);
  await chmod(path, 0o600); await truncate(path, original.indexOf("\n") + 1);
  await assert.rejects(parseMigrationEvidence(path, manifest), /truncat|anchor/i);
  const link = join(root, "link.jsonl"); await symlink(path, link);
  await assert.rejects(parseMigrationEvidence(link, manifest), /regular|symlink/i);
});

test("rollback and retirement require the exact linked cutover chain and seven days", async () => {
  const root = await mkdtemp(join(tmpdir(), "migration-retire-"));
  const path = join(root, "evidence.jsonl");
  const manifest = await pilotThrough(path, "cutover");
  await assert.rejects(recordMigrationEvidence(path, manifest, { type: "retire", ...ids, at: at(2) }, { retired_integrations: ["old-01"], history_preserved: true }), /seven/i);
  await recordMigrationEvidence(path, manifest, { type: "rollback", ...ids, at: at(2) }, { route_generation: "old-01", resources_preserved: true });
  assert.equal(migrationReport(manifest, await parseMigrationEvidence(path, manifest)).status, "rolled_back");

  const second = join(root, "second.jsonl");
  await pilotThrough(second, "retire");
  const report = migrationReport(manifest, await parseMigrationEvidence(second, manifest), new Date(at(8, 6)));
  assert.equal(report.batch, "client-five");
  assert.equal(report.gate, "authority");
});
