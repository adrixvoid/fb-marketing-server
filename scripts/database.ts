import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { backupDatabase, openDatabase, restoreDatabase } from "../src/db.js";
import { defaultRuntimePaths } from "../src/runtime.js";

interface DatabasePaths {
  dataRoot: string;
  databasePath: string;
}

export async function runDatabaseCommand(
  action: string,
  source: string,
  destination?: string,
  paths: DatabasePaths = defaultRuntimePaths(),
): Promise<void> {
  if (!isAbsolute(source) || (destination !== undefined && !isAbsolute(destination))) throw new Error("Database paths must be absolute");
  if (action === "backup") {
    if (destination !== undefined) throw new Error("Usage: database.ts backup <destination>");
    const db = openDatabase(paths.databasePath, paths.dataRoot);
    try {
      await backupDatabase(db, source, paths.dataRoot);
    } finally {
      db.close();
    }
    return;
  }
  if (action === "restore" && destination !== undefined) {
    await restoreDatabase(source, destination, paths.dataRoot);
    return;
  }
  throw new Error("Usage: database.ts backup <destination> | restore <source> <new-destination>");
}

async function main(): Promise<void> {
  const [action = "", source = "", destination] = process.argv.slice(2);
  await runDatabaseCommand(action, source, destination);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Database operation failed"}\n`);
    process.exitCode = 1;
  });
}
