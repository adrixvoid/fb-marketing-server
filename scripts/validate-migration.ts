import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const AGENCY = "3981018332186282";
const PILOT = "290166249089842";
const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1_000;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SECRET_KEY = /^(authorization|password|credential|access[_-]?token|app[_-]?secret|private[_-]?key|.*proof.*)$/i;
const SECRET_VALUE = /authorization\s*:|bearer\s+|access[_-]?token|app[_-]?secret|private[_-]?key|service-token|owner-proof/i;
const ZERO_HASH = "0".repeat(64);

export interface MigrationApp { integration_id: string; app_id: string; client_id: string; business_id: string; ad_account_ids: string[]; target_generation: string }
export interface MigrationManifest { agency_business_id: string; pilot_business_id: string; target_generation: string; apps: MigrationApp[]; batches: string[] }
export interface MigrationAction { type: string; client_id: string; business_id: string; target_generation: string; old_integrations: string[]; ad_account_id?: string; at: string }
export interface MigrationEvent extends MigrationAction { data: Record<string, unknown> }
export interface EvidenceRecord { sequence: number; previous_hash: string; event: MigrationEvent; hash: string }
export interface MigrationReport { status: "blocked" | "rolled_back" | "complete"; batch?: string; gate?: string; next_action: string }

function obj(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid ${name}`);
  return value as Record<string, unknown>;
}

function keys(value: Record<string, unknown>, expected: string[], name: string): void {
  const actual = Object.keys(value).sort();
  if (actual.join("\0") !== [...expected].sort().join("\0")) throw new Error(`Invalid ${name} fields`);
}

function noSecrets(value: unknown, path = "input"): void {
  if (typeof value === "string") {
    if (SECRET_VALUE.test(value)) throw new Error(`Secret material is forbidden at ${path}`);
    return;
  }
  if (Array.isArray(value)) return value.forEach((entry, index) => noSecrets(entry, `${path}[${index}]`));
  if (!value || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) throw new Error(`Secret field is forbidden at ${path}.${key}`);
    noSecrets(entry, `${path}.${key}`);
  }
}

function id(value: unknown, name: string): string {
  if (typeof value !== "string" || !ID.test(value)) throw new Error(`Invalid ${name}`);
  return value;
}

function ids(value: unknown, name: string, allowEmpty = false): string[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) throw new Error(`Invalid ${name}`);
  const result = value.map((entry) => id(entry, name));
  if (new Set(result).size !== result.length) throw new Error(`Invalid duplicate ${name}`);
  return result;
}

function boolean(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") throw new Error(`Invalid ${name}`);
  return value;
}

function integer(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(`Invalid ${name}`);
  return Number(value);
}

function timestamp(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error("Invalid timestamp");
  return value;
}

function canonical(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = obj(value, "canonical value");
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
}

function digest(sequence: number, previous: string, event: MigrationEvent): string {
  return createHash("sha256").update(canonical({ sequence, previous_hash: previous, event })).digest("hex");
}

export function validateMigrationManifest(input: unknown): MigrationManifest {
  noSecrets(input);
  const source = obj(input, "manifest");
  keys(source, ["agency_business_id", "pilot_business_id", "target_generation", "apps", "batches"], "manifest");
  if (source.agency_business_id !== AGENCY || source.pilot_business_id !== PILOT) throw new Error("Invalid required agency or pilot Business ID");
  const target = id(source.target_generation, "target generation");
  if (!Array.isArray(source.apps) || source.apps.length !== 14) throw new Error("Invalid 14-app inventory");
  const apps = source.apps.map((raw, index): MigrationApp => {
    const app = obj(raw, `app ${index}`);
    keys(app, ["integration_id", "app_id", "client_id", "business_id", "ad_account_ids", "target_generation"], `app ${index}`);
    const result = { integration_id: id(app.integration_id, "integration"), app_id: id(app.app_id, "app"), client_id: id(app.client_id, "client"), business_id: id(app.business_id, "business"), ad_account_ids: ids(app.ad_account_ids, "account"), target_generation: id(app.target_generation, "target generation") };
    if (result.target_generation !== target) throw new Error("Invalid target generation binding");
    return result;
  });
  for (const field of ["integration_id", "app_id"] as const) if (new Set(apps.map((app) => app[field])).size !== 14) throw new Error(`Invalid unique ${field}`);
  const clientBusiness = new Map<string, string>();
  const businessClient = new Map<string, string>();
  const accountOwner = new Map<string, string>();
  for (const app of apps) {
    if (clientBusiness.has(app.client_id) && clientBusiness.get(app.client_id) !== app.business_id) throw new Error("Invalid client-to-Business ownership");
    if (businessClient.has(app.business_id) && businessClient.get(app.business_id) !== app.client_id) throw new Error("Invalid Business-to-client ownership");
    clientBusiness.set(app.client_id, app.business_id); businessClient.set(app.business_id, app.client_id);
    for (const account of app.ad_account_ids) {
      const owner = `${app.client_id}\0${app.business_id}`;
      if (accountOwner.has(account) && accountOwner.get(account) !== owner) throw new Error("Invalid cross-Business account ownership");
      accountOwner.set(account, owner);
    }
  }
  const batches = ids(source.batches, "batch");
  if (batches.length !== clientBusiness.size || batches.some((client) => !clientBusiness.has(client))) throw new Error("Invalid client batches");
  const pilotClient = businessClient.get(PILOT);
  if (!pilotClient || batches[0] !== pilotClient) throw new Error("Invalid pilot-first batch");
  const pilotAccounts = [...accountOwner].filter(([, owner]) => owner === `${pilotClient}\0${PILOT}`).map(([account]) => account);
  if (pilotAccounts.length !== 2) throw new Error("Invalid two-account pilot ownership");
  return { agency_business_id: AGENCY, pilot_business_id: PILOT, target_generation: target, apps, batches };
}

function clientFacts(manifest: MigrationManifest, client: string) {
  const apps = manifest.apps.filter((app) => app.client_id === client);
  if (!apps.length) throw new Error("Invalid manifest client binding");
  return { business: apps[0]!.business_id, accounts: [...new Set(apps.flatMap((app) => app.ad_account_ids))], integrations: apps.map((app) => app.integration_id).sort() };
}

function validateAction(manifest: MigrationManifest, action: MigrationAction): MigrationAction {
  const source = obj(action, "action");
  const expected = action.ad_account_id === undefined ? ["type", "client_id", "business_id", "target_generation", "old_integrations", "at"] : ["type", "client_id", "business_id", "target_generation", "old_integrations", "ad_account_id", "at"];
  keys(source, expected, "action"); noSecrets(source);
  const facts = clientFacts(manifest, id(action.client_id, "client"));
  const expectedIntegrations = action.ad_account_id === undefined ? facts.integrations : manifest.apps.filter((app) => app.client_id === action.client_id && app.ad_account_ids.includes(action.ad_account_id!)).map((app) => app.integration_id).sort();
  if (action.business_id !== facts.business || action.target_generation !== manifest.target_generation || !exactList(action.old_integrations, expectedIntegrations) || (action.ad_account_id !== undefined && !facts.accounts.includes(action.ad_account_id))) throw new Error("Invalid action scope or old-integration binding");
  timestamp(action.at); id(action.type, "action type");
  return action;
}

function exactList(actual: unknown, expected: string[]): boolean {
  return Array.isArray(actual) && actual.length === expected.length && [...actual].sort().every((value, index) => value === [...expected].sort()[index]);
}

function latest(events: MigrationEvent[], type: string): MigrationEvent | undefined { return events.filter((event) => event.type === type).at(-1); }
function forClient(events: MigrationEvent[], client: string): MigrationEvent[] { return events.filter((event) => event.client_id === client); }

function validateResponse(manifest: MigrationManifest, history: MigrationEvent[], action: MigrationAction, raw: unknown): Record<string, unknown> {
  noSecrets(raw);
  const data = obj(raw, `${action.type} response`);
  const prior = forClient(history, action.client_id);
  const facts = clientFacts(manifest, action.client_id);
  if (history.length && Date.parse(action.at) < Date.parse(history.at(-1)!.at)) throw new Error("Invalid timestamp order");
  switch (action.type) {
    case "authority":
      if (!action.ad_account_id) throw new Error("Invalid authority account binding");
      keys(data, ["app_access", "token_valid", "token_subject", "partner_relationship", "assigned_assets", "assigned_tasks", "permissions", "endpoint_authority"], "authority response");
      return { app_access: boolean(data.app_access, "app access"), token_valid: boolean(data.token_valid, "token validity"), token_subject: id(data.token_subject, "token subject"), partner_relationship: boolean(data.partner_relationship, "partner relationship"), assigned_assets: ids(data.assigned_assets, "assigned asset"), assigned_tasks: ids(data.assigned_tasks, "assigned task"), permissions: ids(data.permissions, "permission"), endpoint_authority: ids(data.endpoint_authority, "endpoint authority") };
    case "parity":
      if (!action.ad_account_id) throw new Error("Invalid parity account binding");
      keys(data, ["reads_match", "currency_match", "timezone_match", "pacing_match", "variance_ratio", "tolerance_ratio"], "parity response");
      if (![data.variance_ratio, data.tolerance_ratio].every((value) => typeof value === "number" && Number.isFinite(value) && value >= 0)) throw new Error("Invalid parity tolerance");
      return { reads_match: boolean(data.reads_match, "read parity"), currency_match: boolean(data.currency_match, "currency parity"), timezone_match: boolean(data.timezone_match, "timezone parity"), pacing_match: boolean(data.pacing_match, "pacing parity"), variance_ratio: data.variance_ratio, tolerance_ratio: data.tolerance_ratio };
    case "paused_canary": {
      if (!action.ad_account_id || migrationReport(manifest, history).gate !== "paused_canary") throw new Error("Invalid prior authority and parity chain");
      keys(data, ["proposal_id", "owner_decision_id", "owner_decision", "operation_id", "execution_id", "operation_generation", "resources"], "paused canary response");
      if (data.owner_decision !== "approved") throw new Error("Paused canary requires an approved owner decision");
      if (data.operation_generation !== manifest.target_generation || !Array.isArray(data.resources) || data.resources.length !== 3) throw new Error("Invalid paused canary generation or resources");
      const resources = data.resources.map((rawResource) => { const resource = obj(rawResource, "canary resource"); keys(resource, ["kind", "id", "status"], "canary resource"); if (resource.status !== "PAUSED") throw new Error("All canary resources must remain PAUSED"); return { kind: id(resource.kind, "resource kind"), id: id(resource.id, "resource id"), status: "PAUSED" }; });
      if (!exactList(resources.map((resource) => resource.kind), ["campaign", "ad_set", "ad"])) throw new Error("Invalid paused canary resource set");
      return { proposal_id: id(data.proposal_id, "proposal"), owner_decision_id: id(data.owner_decision_id, "owner decision"), owner_decision: "approved", operation_id: id(data.operation_id, "operation"), execution_id: id(data.execution_id, "execution"), operation_generation: manifest.target_generation, resources };
    }
    case "owner_signoff":
      if (!latest(prior, "paused_canary")) throw new Error("Invalid owner signoff without prior paused canary");
      keys(data, ["owner_identity", "accepted"], "owner signoff response");
      if (boolean(data.accepted, "owner acceptance") !== true) throw new Error("Invalid owner rejection");
      return { owner_identity: id(data.owner_identity, "owner identity"), accepted: true };
    case "freeze_reconciliation":
      if (!latest(prior, "owner_signoff")) throw new Error("Invalid freeze without prior owner signoff");
      keys(data, ["mutations_frozen", "in_flight_operations", "ambiguous_operations", "resolved_operation_ids"], "freeze response");
      return { mutations_frozen: boolean(data.mutations_frozen, "mutation freeze"), in_flight_operations: integer(data.in_flight_operations, "in-flight operations"), ambiguous_operations: integer(data.ambiguous_operations, "ambiguous operations"), resolved_operation_ids: ids(data.resolved_operation_ids, "resolved operation", true) };
    case "cutover": {
      const freeze = latest(prior, "freeze_reconciliation");
      if (!freeze || freeze.data.mutations_frozen !== true || freeze.data.in_flight_operations !== 0 || freeze.data.ambiguous_operations !== 0) throw new Error("Invalid cutover before freeze and reconciliation");
      keys(data, ["route_generation", "previous_integrations"], "cutover response");
      if (data.route_generation !== manifest.target_generation || !exactList(data.previous_integrations, facts.integrations)) throw new Error("Invalid cutover generation or integration set");
      return { route_generation: manifest.target_generation, previous_integrations: facts.integrations };
    }
    case "observation": {
      const cutover = latest(prior, "cutover");
      if (!cutover || Date.parse(action.at) - Date.parse(cutover.at) < SEVEN_DAYS) throw new Error("Invalid observation before seven full days");
      keys(data, ["healthy", "resources_preserved"], "observation response");
      return { healthy: boolean(data.healthy, "observation health"), resources_preserved: boolean(data.resources_preserved, "resource preservation") };
    }
    case "retire": {
      const observation = latest(prior, "observation");
      const cutover = latest(prior, "cutover");
      if (!observation || !cutover || observation.data.healthy !== true || Date.parse(action.at) - Date.parse(cutover.at) < SEVEN_DAYS) throw new Error("Invalid retirement before seven-day observation");
      keys(data, ["retired_integrations", "history_preserved"], "retire response");
      if (!exactList(data.retired_integrations, facts.integrations) || data.history_preserved !== true) throw new Error("Invalid retirement integration set or history");
      return { retired_integrations: facts.integrations, history_preserved: true };
    }
    case "rollback": {
      const cutover = latest(prior, "cutover");
      if (!cutover || latest(prior, "retire")) throw new Error("Invalid bare or post-retirement rollback");
      keys(data, ["route_generation", "resources_preserved"], "rollback response");
      if (!facts.integrations.includes(String(data.route_generation)) || data.resources_preserved !== true) throw new Error("Invalid rollback generation or resource preservation");
      return { route_generation: data.route_generation, resources_preserved: true };
    }
    default: throw new Error("Invalid migration action type");
  }
}

function validateEvent(manifest: MigrationManifest, history: MigrationEvent[], raw: unknown): MigrationEvent {
  const event = obj(raw, "evidence event") as unknown as MigrationEvent;
  const expected = event.ad_account_id === undefined ? ["type", "client_id", "business_id", "target_generation", "old_integrations", "at", "data"] : ["type", "client_id", "business_id", "target_generation", "old_integrations", "ad_account_id", "at", "data"];
  keys(event as unknown as Record<string, unknown>, expected, "evidence event");
  const { data, ...rawAction } = event;
  const action = validateAction(manifest, rawAction);
  return { ...action, data: validateResponse(manifest, history, action, data) };
}

function blocked(batch: string | undefined, gate: string, next_action: string): MigrationReport { return { status: "blocked", ...(batch ? { batch } : {}), gate, next_action }; }

export function migrationReport(input: unknown, evidence: MigrationEvent[], now = new Date()): MigrationReport {
  let manifest: MigrationManifest;
  try { manifest = validateMigrationManifest(input); } catch { return blocked(undefined, "manifest", "Correct the exact 14-app agency, pilot, client, Business, account, generation, and batch manifest bindings"); }
  for (const batch of manifest.batches) {
    const facts = clientFacts(manifest, batch); const events = forClient(evidence, batch);
    const rollback = latest(events, "rollback"); if (rollback && !latest(events, "retire")) return { status: "rolled_back", batch, gate: "rollback", next_action: `Keep history and resources, correct ${batch}, then restart authority validation` };
    const authority = events.filter((event) => event.type === "authority");
    const missingAuthority = facts.accounts.filter((account) => { const data = authority.findLast((event) => event.ad_account_id === account)?.data; return !data || data.app_access !== true || data.token_valid !== true || typeof data.token_subject !== "string" || data.partner_relationship !== true || !exactList(data.assigned_assets, [account]) || !exactList(data.assigned_tasks, ["ADVERTISE", "MANAGE"]) || !exactList(data.permissions, ["ads_read", "ads_management"]) || !exactList(data.endpoint_authority, ["campaigns.read", "insights.read", "campaigns.write"]); });
    if (missingAuthority.length) return blocked(batch, "authority", `Validate app access, token subject/validity, partner access, assignments/tasks, permissions, assets, and endpoint authority for ${missingAuthority.join(", ")}`);
    const parity = events.filter((event) => event.type === "parity");
    const missingParity = facts.accounts.filter((account) => { const data = parity.findLast((event) => event.ad_account_id === account)?.data; return !data || data.reads_match !== true || data.currency_match !== true || data.timezone_match !== true || data.pacing_match !== true || Number(data.variance_ratio) > Number(data.tolerance_ratio); });
    if (missingParity.length) return blocked(batch, "parity", `Validate reads, currency, timezone, and pacing parity within tolerance for ${missingParity.join(", ")}`);
    if (!latest(events, "paused_canary")) return blocked(batch, "paused_canary", `Run one linked owner-approved PAUSED canary for ${batch}`);
    if (!latest(events, "owner_signoff")) return blocked(batch, "owner_signoff", `Record owner signoff linked after the PAUSED canary for ${batch}`);
    const freeze = latest(events, "freeze_reconciliation");
    if (!freeze || freeze.data.mutations_frozen !== true || freeze.data.in_flight_operations !== 0 || freeze.data.ambiguous_operations !== 0) return blocked(batch, "freeze_reconciliation", `Freeze mutations and reconcile ${batch} to zero in-flight and ambiguous operations`);
    const cutover = latest(events, "cutover"); if (!cutover) return blocked(batch, "cutover", `Switch only ${batch} to ${manifest.target_generation} and retain ${facts.integrations.join(", ")}`);
    const observation = latest(events, "observation");
    if (!observation || observation.data.healthy !== true || now.getTime() - Date.parse(cutover.at) < SEVEN_DAYS) return blocked(batch, "observation_7d", `Observe ${batch} for seven full days while retaining exact rollback integrations`);
    if (!latest(events, "retire")) return blocked(batch, "retire", `Retire exactly ${facts.integrations.join(", ")} after observation while preserving history and resources`);
  }
  return { status: "complete", next_action: "All 14 app integrations completed the linked phased migration" };
}

async function privateParent(path: string): Promise<void> {
  const parent = dirname(path);
  try { await mkdir(parent, { mode: 0o700 }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw new Error("Invalid evidence parent"); }
  const info = await lstat(parent);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o777) !== 0o700 || (process.getuid && info.uid !== process.getuid())) throw new Error("Evidence parent must be a private regular directory");
}

async function regularPrivate(path: string): Promise<void> {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error("Evidence path must be a regular non-symlink file");
  if ((info.mode & 0o777) !== 0o600 || (process.getuid && info.uid !== process.getuid())) throw new Error("Evidence file must be private mode 0600");
}

async function readRecords(path: string, manifest?: MigrationManifest): Promise<{ records: EvidenceRecord[]; events: MigrationEvent[] }> {
  await privateParent(path); await regularPrivate(path); await regularPrivate(`${path}.anchor`);
  const lines = (await readFile(path, "utf8")).split("\n").filter(Boolean);
  const records: EvidenceRecord[] = []; const events: MigrationEvent[] = [];
  let previous = ZERO_HASH;
  for (let index = 0; index < lines.length; index++) {
    let record: EvidenceRecord;
    try { record = JSON.parse(lines[index]!) as EvidenceRecord; } catch { throw new Error("Evidence integrity validation failed"); }
    const source = obj(record, "evidence record"); keys(source, ["sequence", "previous_hash", "event", "hash"], "evidence record");
    if (record.sequence !== index + 1 || record.previous_hash !== previous || record.hash !== digest(record.sequence, previous, record.event)) throw new Error("Evidence integrity validation failed");
    const event = manifest ? validateEvent(manifest, events, record.event) : record.event;
    timestamp(event.at); noSecrets(event); records.push(record); events.push(event); previous = record.hash;
  }
  const anchor = obj(JSON.parse(await readFile(`${path}.anchor`, "utf8")), "evidence anchor"); keys(anchor, ["sequence", "hash"], "evidence anchor");
  if (anchor.sequence !== records.length || anchor.hash !== previous) throw new Error("Evidence truncation or anchor mismatch");
  return { records, events };
}

export async function parseMigrationEvidence(path: string, manifest: MigrationManifest): Promise<MigrationEvent[]> { return (await readRecords(path, manifest)).events; }

async function atomicAnchor(path: string, sequence: number, hash: string): Promise<void> {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify({ sequence, hash }), { mode: 0o600, flag: "wx" }); await chmod(temporary, 0o600); await rename(temporary, path);
}

export async function recordMigrationEvidence(path: string, manifest: MigrationManifest, action: MigrationAction, response: unknown): Promise<void> {
  if (!isAbsolute(path)) throw new Error("Evidence path must be absolute");
  noSecrets(action); noSecrets(response); await privateParent(path);
  let records: EvidenceRecord[] = []; let history: MigrationEvent[] = [];
  try { ({ records, events: history } = await readRecords(path, manifest)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const current = migrationReport(manifest, history);
  if (current.batch && action.client_id !== current.batch && action.type !== "rollback") throw new Error("Invalid out-of-order client batch");
  const validAction = validateAction(manifest, action);
  const event: MigrationEvent = { ...validAction, data: validateResponse(manifest, history, validAction, response) };
  const sequence = records.length + 1; const previous = records.at(-1)?.hash ?? ZERO_HASH; const hash = digest(sequence, previous, event);
  if (!records.length) {
    const handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0), 0o600);
    try { await handle.writeFile(`${JSON.stringify({ sequence, previous_hash: previous, event, hash })}\n`); await handle.sync(); } finally { await handle.close(); }
  } else {
    await regularPrivate(path);
    const handle = await open(path, constants.O_APPEND | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0));
    try { await handle.writeFile(`${JSON.stringify({ sequence, previous_hash: previous, event, hash })}\n`); await handle.sync(); } finally { await handle.close(); }
  }
  await chmod(path, 0o600); await atomicAnchor(`${path}.anchor`, sequence, hash);
}

async function stdin(): Promise<string> { const chunks: Buffer[] = []; let size = 0; for await (const chunk of process.stdin) { const bytes = Buffer.from(chunk); size += bytes.length; if (size > 64 * 1024) throw new Error("Input too large"); chunks.push(bytes); } return Buffer.concat(chunks).toString("utf8"); }

async function main(): Promise<void> {
  const [command, manifestPath, evidencePath] = process.argv.slice(2);
  try {
    if (!manifestPath || !evidencePath) throw new Error("invalid usage");
    const manifestInput = JSON.parse(await readFile(manifestPath, "utf8"));
    if (command === "validate") {
      let events: MigrationEvent[] = []; let manifest: MigrationManifest | undefined;
      try { manifest = validateMigrationManifest(manifestInput); events = await parseMigrationEvidence(evidencePath, manifest); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      process.stdout.write(`${JSON.stringify(migrationReport(manifestInput, events))}\n`); return;
    }
    if (command === "record") {
      const manifest = validateMigrationManifest(manifestInput); const payload = obj(JSON.parse(await stdin()), "record input"); keys(payload, ["action", "gateway_response"], "record input");
      await recordMigrationEvidence(evidencePath, manifest, payload.action as MigrationAction, payload.gateway_response); process.stdout.write('{"status":"recorded"}\n'); return;
    }
    throw new Error("invalid usage");
  } catch {
    process.stdout.write(`${JSON.stringify(blocked(undefined, "validation", "Correct the manifest, linked gateway response, evidence integrity, permissions, or file ownership before retrying"))}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
