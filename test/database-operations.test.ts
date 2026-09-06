import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runDatabaseCommand } from "../scripts/database.js";
import { openDatabase } from "../src/db.js";

test("database operations produce a verified backup and a restartable restored database", async () => {
  const root = await mkdtemp(join(tmpdir(), "database-operations-"));
  const live = join(root, "state.sqlite");
  openDatabase(live, root).close();
  const backup = join(root, "state.backup.sqlite");
  const restored = join(root, "state.restored.sqlite");

  await runDatabaseCommand("backup", backup, undefined, { dataRoot: root, databasePath: live });
  await runDatabaseCommand("restore", backup, restored, { dataRoot: root, databasePath: live });
  const db = openDatabase(restored, root);
  assert.equal(db.prepare("PRAGMA user_version").get()!.user_version, 8);
  db.close();
});
