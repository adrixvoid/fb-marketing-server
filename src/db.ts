import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  lstatSync,
  mkdtempSync,
  openSync,
  realpathSync,
  renameSync,
  rmSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { migrations, runMigrations } from "./migrations.js";

function ownedOnly(mode: number, uid: number): boolean {
  return (mode & 0o077) === 0 && (process.getuid === undefined || uid === process.getuid());
}

function privateDirectory(path: string): void {
  const entry = lstatSync(path);
  if (entry.isSymbolicLink() || !entry.isDirectory() || !ownedOnly(entry.mode, entry.uid)) {
    throw new Error("Backup temporary directory is unsafe");
  }
}

function trustedPath(path: string, dataRoot: string): string {
  const root = resolve(dataRoot);
  const rootStat = lstatSync(root);
  if (rootStat.isSymbolicLink()) throw new Error("Trusted data root must not be a symlink");
  if (!rootStat.isDirectory() || !ownedOnly(rootStat.mode, rootStat.uid)) throw new Error("Trusted data root is unsafe");

  const canonicalRoot = realpathSync(root);
  const target = resolve(path);
  const lexicalDistance = relative(root, target);
  const canonicalDistance = relative(canonicalRoot, target);
  const base =
    lexicalDistance !== ".." && !lexicalDistance.startsWith(`..${sep}`)
      ? root
      : canonicalDistance !== ".." && !canonicalDistance.startsWith(`..${sep}`)
        ? canonicalRoot
        : undefined;
  const fromRoot = base === undefined ? ".." : relative(base, target);
  if (fromRoot === "" || fromRoot === ".." || fromRoot.startsWith(`..${sep}`)) {
    throw new Error("Path is outside the trusted data root");
  }

  let parent = dirname(target);
  const parents: string[] = [];
  while (parent !== base) {
    const parentRelative = relative(base!, parent);
    if (parentRelative === ".." || parentRelative.startsWith(`..${sep}`)) {
      throw new Error("Path is outside the trusted data root");
    }
    parents.push(parent);
    parent = dirname(parent);
  }
  for (const directory of parents.reverse()) {
    const entry = lstatSync(directory);
    if (entry.isSymbolicLink()) throw new Error("Trusted path parent must not be a symlink");
    if (!entry.isDirectory() || !ownedOnly(entry.mode, entry.uid)) throw new Error("Trusted path parent is unsafe");
  }
  return target;
}

function existingRegularFile(path: string, dataRoot: string): string {
  const target = trustedPath(path, dataRoot);
  const entry = lstatSync(target);
  if (entry.isSymbolicLink()) throw new Error("Trusted file must not be a symlink");
  if (!entry.isFile() || entry.nlink !== 1 || !ownedOnly(entry.mode, entry.uid)) throw new Error("Trusted file is unsafe");
  return target;
}

function newFile(path: string, dataRoot: string): string {
  const target = trustedPath(path, dataRoot);
  try {
    if (lstatSync(target).isSymbolicLink()) throw new Error("Destination must not be a symlink");
    throw new Error("Destination already exists");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return target;
}

export function openDatabase(path: ":memory:"): DatabaseSync;
export function openDatabase(path: string, dataRoot: string): DatabaseSync;
export function openDatabase(path: string, dataRoot?: string): DatabaseSync {
  let databasePath = path;
  if (path !== ":memory:") {
    if (dataRoot === undefined) throw new Error("A trusted data root is required");
    databasePath = trustedPath(path, dataRoot);
    try {
      existingRegularFile(databasePath, dataRoot);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  const db = new DatabaseSync(databasePath, {
    enableForeignKeyConstraints: true,
    enableDoubleQuotedStringLiterals: false,
    allowExtension: false,
    timeout: 5_000,
  });
  try {
    if (path !== ":memory:") chmodSync(databasePath, 0o600);
    db.exec("PRAGMA foreign_keys = ON; PRAGMA trusted_schema = OFF; PRAGMA synchronous = FULL");
    if (path !== ":memory:") db.exec("PRAGMA journal_mode = WAL");
    runMigrations(db);
    db.enableDefensive(true);
    return db;
  } catch (error) {
    try {
      db.close();
    } catch {
      // Preserve the initialization failure.
    }
    throw error;
  }
}

type Synchronous<T> = T extends PromiseLike<unknown> ? never : T;

export function transaction<T>(db: DatabaseSync, work: () => Synchronous<T>): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = work() as T;
    if (
      result !== null &&
      (typeof result === "object" || typeof result === "function") &&
      typeof (result as unknown as PromiseLike<unknown>).then === "function"
    ) {
      void Promise.resolve(result).catch(() => undefined);
      throw new Error("Transaction callback must be synchronous");
    }
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function quotedIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function normalizedSql(value: unknown): string | null {
  return value === null ? null : String(value).trim();
}

function schemaFingerprint(db: DatabaseSync): string {
  const schema = db
    .prepare(`
      SELECT type, name, tbl_name, sql
        FROM sqlite_schema
       WHERE name NOT LIKE 'sqlite_%'
       ORDER BY type, name
    `)
    .all()
    .map((row) => ({
      type: String(row.type),
      name: String(row.name),
      table: String(row.tbl_name),
      sql: normalizedSql(row.sql),
    }));
  const tables = schema
    .filter(({ type }) => type === "table")
    .map(({ name }) => {
      const identifier = quotedIdentifier(name);
      const columns = db
        .prepare(`PRAGMA table_xinfo(${identifier})`)
        .all()
        .map((row) => ({
          cid: Number(row.cid),
          name: String(row.name),
          type: String(row.type),
          notNull: Number(row.notnull),
          defaultValue: row.dflt_value === null ? null : String(row.dflt_value),
          primaryKey: Number(row.pk),
          hidden: Number(row.hidden),
        }))
        .sort((a, b) => a.cid - b.cid);
      const foreignKeys = db
        .prepare(`PRAGMA foreign_key_list(${identifier})`)
        .all()
        .map((row) => ({
          id: Number(row.id),
          sequence: Number(row.seq),
          table: String(row.table),
          from: String(row.from),
          to: String(row.to),
          onUpdate: String(row.on_update),
          onDelete: String(row.on_delete),
          match: String(row.match),
        }))
        .sort((a, b) => a.id - b.id || a.sequence - b.sequence);
      const indexes = db
        .prepare(`PRAGMA index_list(${identifier})`)
        .all()
        .map((row) => {
          const indexName = String(row.name);
          return {
            name: indexName,
            unique: Number(row.unique),
            origin: String(row.origin),
            partial: Number(row.partial),
            columns: db
              .prepare(`PRAGMA index_xinfo(${quotedIdentifier(indexName)})`)
              .all()
              .map((column) => ({
                sequence: Number(column.seqno),
                cid: Number(column.cid),
                name: column.name === null ? null : String(column.name),
                descending: Number(column.desc),
                collation: column.coll === null ? null : String(column.coll),
                key: Number(column.key),
              }))
              .sort((a, b) => a.sequence - b.sequence),
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
      return { name, columns, foreignKeys, indexes };
    });
  return createHash("sha256").update(JSON.stringify({ schema, tables })).digest("hex");
}

let canonicalFingerprint: string | undefined;

function expectedSchemaFingerprint(): string {
  if (canonicalFingerprint !== undefined) return canonicalFingerprint;
  const canonical = new DatabaseSync(":memory:");
  try {
    runMigrations(canonical);
    canonicalFingerprint = schemaFingerprint(canonical);
    return canonicalFingerprint;
  } finally {
    canonical.close();
  }
}

function verifyBackup(path: string): void {
  const snapshot = new DatabaseSync(path, { readOnly: true, allowExtension: false, timeout: 5_000 });
  try {
    const integrity = snapshot.prepare("PRAGMA integrity_check").all();
    const foreignKeyViolations = snapshot.prepare("PRAGMA foreign_key_check").all();
    const version = Number(snapshot.prepare("PRAGMA user_version").get()!.user_version);
    if (
      integrity.length !== 1 ||
      integrity[0]?.integrity_check !== "ok" ||
      foreignKeyViolations.length !== 0 ||
      version !== migrations.at(-1)!.version ||
      schemaFingerprint(snapshot) !== expectedSchemaFingerprint()
    ) {
      throw new Error("Backup integrity, foreign keys, or schema fingerprint validation failed");
    }
  } finally {
    snapshot.close();
  }
}

export interface BackupOptions {
  onProgress?: (state: { temporaryDirectory: string; temporaryPath: string }) => void;
}

async function publishBackup(
  source: DatabaseSync,
  destination: string,
  dataRoot: string,
  options: BackupOptions = {},
): Promise<void> {
  const target = newFile(destination, dataRoot);
  const temporaryDirectory = mkdtempSync(join(dirname(target), ".backup-"));
  const temporary = join(temporaryDirectory, `${randomUUID()}.sqlite`);
  let reserved = false;
  try {
    chmodSync(temporaryDirectory, 0o700);
    privateDirectory(temporaryDirectory);
    closeSync(openSync(temporary, "wx", 0o600));
    existingRegularFile(temporary, dataRoot);
    closeSync(openSync(target, "wx", 0o600));
    reserved = true;
    await backup(source, temporary, {
      progress: () => {
        privateDirectory(temporaryDirectory);
        existingRegularFile(temporary, dataRoot);
        existingRegularFile(target, dataRoot);
        options.onProgress?.({ temporaryDirectory, temporaryPath: temporary });
      },
    });
    chmodSync(temporary, 0o600);
    privateDirectory(temporaryDirectory);
    existingRegularFile(temporary, dataRoot);
    verifyBackup(temporary);
    renameSync(temporary, target);
    rmSync(temporaryDirectory, { recursive: true });
  } catch {
    rmSync(temporaryDirectory, { force: true, recursive: true });
    if (reserved) rmSync(target, { force: true });
    throw new Error("Protected backup failed");
  }
}

export async function backupDatabase(
  db: DatabaseSync,
  destination: string,
  dataRoot: string,
  options: BackupOptions = {},
): Promise<void> {
  const source = db.location();
  if (source !== null) existingRegularFile(source, dataRoot);
  await publishBackup(db, destination, dataRoot, options);
}

export async function restoreDatabase(source: string, destination: string, dataRoot: string): Promise<void> {
  const sourcePath = existingRegularFile(source, dataRoot);
  newFile(destination, dataRoot);
  try {
    verifyBackup(sourcePath);
  } catch {
    throw new Error("Protected restore schema validation failed");
  }
  const snapshot = new DatabaseSync(sourcePath, { readOnly: true, allowExtension: false, timeout: 5_000 });
  try {
    await publishBackup(snapshot, destination, dataRoot);
  } finally {
    snapshot.close();
  }
}

interface AuditEvidence {
  externalRequestId?: string;
  errorCode?: string;
  httpStatus?: number;
  retryAfter?: string;
}

export interface AuditEvent {
  actor: string;
  clientId?: string;
  adAccountId?: string;
  generationId?: string;
  operation: string;
  correlationId: string;
  occurredAt: string;
  outcome: "started" | "succeeded" | "failed";
  evidence?: AuditEvidence;
}

const secretShape = /authorization|bearer\s|access[_-]?token|app[_-]?secret|service[_-]?credential|encryption[_-]?key/i;
const safeIdentifier = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/;

function auditString(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum &&
    !/[\u0000-\u001f\u007f]/.test(value) &&
    !secretShape.test(value) &&
    safeIdentifier.test(value)
  );
}

function validateEvidence(value: unknown): AuditEvidence {
  if (value === undefined) return {};
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid audit evidence");
  const input = value as Record<string, unknown>;
  const allowed = new Set(["externalRequestId", "errorCode", "httpStatus", "retryAfter"]);
  if (Object.keys(input).some((key) => !allowed.has(key))) throw new Error("Invalid audit evidence");

  const evidence: AuditEvidence = {};
  if (input.externalRequestId !== undefined) {
    if (!auditString(input.externalRequestId, 200)) throw new Error("Invalid audit evidence");
    evidence.externalRequestId = input.externalRequestId;
  }
  if (input.errorCode !== undefined) {
    if (!auditString(input.errorCode, 100)) throw new Error("Invalid audit evidence");
    evidence.errorCode = input.errorCode;
  }
  if (input.httpStatus !== undefined) {
    if (!Number.isInteger(input.httpStatus) || (input.httpStatus as number) < 100 || (input.httpStatus as number) > 599) {
      throw new Error("Invalid audit evidence");
    }
    evidence.httpStatus = input.httpStatus as number;
  }
  if (input.retryAfter !== undefined) {
    if (typeof input.retryAfter !== "string" || !/^[0-9]{1,10}$/.test(input.retryAfter)) throw new Error("Invalid audit evidence");
    evidence.retryAfter = input.retryAfter;
  }
  return evidence;
}

function validateAudit(event: AuditEvent): AuditEvidence {
  const allowed = new Set([
    "actor",
    "clientId",
    "adAccountId",
    "generationId",
    "operation",
    "correlationId",
    "occurredAt",
    "outcome",
    "evidence",
  ]);
  if (Object.keys(event).some((key) => !allowed.has(key))) throw new Error("Invalid audit metadata");
  if (!auditString(event.actor, 200) || !auditString(event.operation, 100) || !auditString(event.correlationId, 200)) {
    throw new Error("Invalid audit metadata");
  }
  if (
    !/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/.test(event.occurredAt) ||
    Number.isNaN(Date.parse(event.occurredAt)) ||
    new Date(event.occurredAt).toISOString() !== event.occurredAt
  ) {
    throw new Error("Invalid audit metadata");
  }
  if (!(["started", "succeeded", "failed"] as const).includes(event.outcome)) throw new Error("Invalid audit metadata");

  const scope = [event.clientId, event.adAccountId, event.generationId];
  if (scope.some((value) => value === undefined) && scope.some((value) => value !== undefined)) throw new Error("Invalid audit metadata");
  if (scope.some((value) => value !== undefined && !auditString(value, 255))) throw new Error("Invalid audit metadata");
  return validateEvidence(event.evidence);
}

export function appendAudit(db: DatabaseSync, event: AuditEvent): string {
  const evidence = validateAudit(event);
  const id = randomUUID();
  db.prepare(`
    INSERT INTO audit_log
      (id, actor, client_id, ad_account_id, generation_id, logical_operation, correlation_id,
       occurred_at, outcome, evidence)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    event.actor,
    event.clientId ?? null,
    event.adAccountId ?? null,
    event.generationId ?? null,
    event.operation,
    event.correlationId,
    event.occurredAt,
    event.outcome,
    JSON.stringify(evidence),
  );
  return id;
}
