import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("hybrid apply progress materializes cumulative Strict TDD evidence", async () => {
  const progress = await readFile(
    new URL("../openspec/changes/meta-ads-local-gateway/apply-progress.md", import.meta.url),
    "utf8",
  );

  assert.match(progress, /Initial Unit 1 Verification/);
  assert.match(progress, /First Unit 1 Remediation — Strict TDD Cycle Evidence/);
  assert.match(progress, /Second Unit 1 Remediation — Strict TDD Cycle Evidence/);
  assert.match(progress, /Third Unit 1 Remediation — Strict TDD Cycle Evidence/);
  assert.match(progress, /Unit 2 — Strict TDD Cycle Evidence/);
  assert.match(progress, /Unit 2 Security Review Remediation — Strict TDD Cycle Evidence/);
  assert.match(progress, /Unit 2 Focused Review Remediation — Strict TDD Cycle Evidence/);
  assert.match(progress, /Unit 3 — Strict TDD Cycle Evidence/);
  assert.match(progress, /Unit 3 Review Remediation — Strict TDD Cycle Evidence/);
  assert.match(progress, /Unit 4 — Strict TDD Cycle Evidence/);
  assert.match(progress, /11\/16 tasks complete/);
});
