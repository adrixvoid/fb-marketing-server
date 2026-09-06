import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { buildApp, type AppOptions } from "./app.js";
import { createApprovalHandlers, createApprovalService, validOwnerIdentity } from "./approval.js";
import { appendAudit, openDatabase, transaction } from "./db.js";
import { createMetaClient, MetaError, type MetaScope } from "./meta-client.js";
import { createMediaHandlers, createMediaService } from "./media.js";
import { createExecutionService, createOperationHandlers, createOperationsService } from "./operations.js";
import { createPacingHandlers, createPacingService } from "./pacing.js";
import { createReportingHandlers, createReportingService } from "./reporting.js";
import {
  decryptCredential,
  getOrCreateEncryptionKey,
  MacOSKeychainSecretProvider,
  type EncryptedCredential,
  type SecretProvider,
} from "./secrets.js";

export function defaultRuntimePaths(home = homedir()) {
  const dataRoot = join(home, "Library", "Application Support", "fb-marketing-server");
  return { dataRoot, databasePath: join(dataRoot, "state.sqlite") };
}

export function runtimeEnvironment(environment: Record<string, string | undefined>) {
  const serviceToken = environment.OPENCLAW_SERVICE_TOKEN;
  if (!serviceToken) throw new Error("OPENCLAW_SERVICE_TOKEN is required");
  const ownerIdentity = environment.OPENCLAW_OWNER_IDENTITY;
  if (!ownerIdentity) throw new Error("OPENCLAW_OWNER_IDENTITY is required");
  if (!validOwnerIdentity(ownerIdentity)) throw new Error("Invalid OPENCLAW_OWNER_IDENTITY");
  const rawPort = environment.PORT ?? "3000";
  if (!/^[1-9][0-9]{0,4}$/.test(rawPort)) throw new Error("Invalid PORT");
  const port = Number(rawPort);
  if (port > 65_535) throw new Error("Invalid PORT");
  return { serviceToken, ownerIdentity, port };
}

export async function loadProductionEnvironment(
  secrets: SecretProvider,
  environment: Record<string, string | undefined>,
) {
  const [serviceToken, ownerIdentity] = await Promise.all([
    secrets.get("openclaw-service-token"),
    secrets.get("openclaw-owner-identity"),
  ]);
  return runtimeEnvironment({
    PORT: environment.PORT,
    OPENCLAW_SERVICE_TOKEN: serviceToken,
    OPENCLAW_OWNER_IDENTITY: ownerIdentity,
  });
}

interface RuntimeTestHooks {
  onDatabaseClose?: () => void;
}

export interface RuntimeOptions {
  serviceToken: string;
  ownerIdentity: string;
  actor?: string;
  dataRoot?: string;
  databasePath?: string;
  mediaRoot?: string;
  secretProvider?: SecretProvider;
  cursorKey?: Buffer;
  fetch?: typeof globalThis.fetch;
  now?: () => Date;
  buildApplication?: (options: AppOptions) => ReturnType<typeof buildApp>;
  testHooks?: RuntimeTestHooks;
}

interface CredentialRow {
  id: string;
  generation_id: string;
  subject_id: string;
  key_ref: string;
  envelope_version: number;
  ciphertext: string;
  iv: string;
  auth_tag: string;
}

export function validatedMetaTarget(
  data: Record<string, unknown>,
  input: { objectType: "campaign" | "ad_set" | "ad"; objectId: string; adAccountId: string },
): string | undefined {
  const accountId = typeof data.account_id === "string"
    ? data.account_id
    : data.account_id !== null && typeof data.account_id === "object"
      ? (data.account_id as { id?: unknown }).id
      : undefined;
  const typeMatches = input.objectType === "campaign"
    ? typeof data.objective === "string" && data.objective.length > 0
    : input.objectType === "ad_set"
      ? typeof data.optimization_goal === "string" && data.optimization_goal.length > 0
      : data.creative !== null && typeof data.creative === "object" && typeof (data.creative as { id?: unknown }).id === "string";
  return data.id === input.objectId && typeof accountId === "string" &&
    accountId.replace(/^act_/, "") === input.adAccountId.replace(/^act_/, "") && typeMatches
    ? data.id
    : undefined;
}

export function isSemanticTargetFailure(error: unknown): boolean {
  return error instanceof MetaError && !error.transient && error.code === "meta_100" && (error.status === 400 || error.status === 404);
}

function credentialLoader(db: DatabaseSync, secrets: SecretProvider) {
  return async (scope: MetaScope) => {
    const row = db.prepare(`
      SELECT ec.id, ec.generation_id, ec.subject_id, ec.key_ref, ec.envelope_version,
             ec.ciphertext, ec.iv, ec.auth_tag
        FROM scope_mappings sm
        JOIN encrypted_credentials ec ON ec.generation_id = sm.generation_id
       WHERE sm.client_id = ? AND sm.ad_account_id = ? AND sm.generation_id = ?
         AND sm.active = 1 AND ec.status = 'active' AND ec.validated_at IS NOT NULL AND ec.revoked_at IS NULL
    `).get(scope.clientId, scope.adAccountId, scope.generationId) as unknown as CredentialRow | undefined;
    if (row === undefined) throw new Error("Scoped Meta credential is unavailable");
    const envelope: EncryptedCredential = {
      version: row.envelope_version as 1,
      ciphertext: row.ciphertext,
      iv: row.iv,
      tag: row.auth_tag,
    };
    const plaintext = await decryptCredential(
      secrets,
      row.key_ref,
      { credentialId: row.id, generationId: row.generation_id, subjectId: row.subject_id },
      envelope,
    );
    try {
      const value = JSON.parse(plaintext) as unknown;
      if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error();
      const record = value as Record<string, unknown>;
      if (
        Object.keys(record).length !== 2 ||
        typeof record.accessToken !== "string" ||
        record.accessToken.length === 0 ||
        typeof record.appSecret !== "string" ||
        record.appSecret.length === 0
      ) {
        throw new Error();
      }
      return { accessToken: record.accessToken, appSecret: record.appSecret };
    } catch {
      throw new Error("Scoped Meta credential is invalid");
    }
  };
}

export async function createRuntime(options: RuntimeOptions) {
  if (!options.serviceToken) throw new Error("SERVICE_BEARER_TOKEN is required");
  if (!validOwnerIdentity(options.ownerIdentity)) throw new Error("A channel-scoped owner identity is required");
  const defaults = defaultRuntimePaths();
  const dataRoot = options.dataRoot ?? defaults.dataRoot;
  const databasePath = options.databasePath ?? (options.dataRoot === undefined ? defaults.databasePath : join(dataRoot, "state.sqlite"));
  await mkdir(dataRoot, { recursive: true, mode: 0o700 });
  const db = openDatabase(databasePath, dataRoot);
  let closed = false;
  const closeDatabase = () => {
    if (closed) return;
    closed = true;
    db.close();
    options.testHooks?.onDatabaseClose?.();
  };

  try {
    const secrets = options.secretProvider ?? new MacOSKeychainSecretProvider("fb-marketing-server");
    const cursorKey = options.cursorKey ?? Buffer.from(await getOrCreateEncryptionKey(secrets, "cursor-hmac-key"), "base64");
    await getOrCreateEncryptionKey(secrets, "owner-proof-hmac-key");
    const meta = createMetaClient({
      fetch: options.fetch ?? globalThis.fetch,
      getCredentials: credentialLoader(db, secrets),
      audit: (event, executionStep) => transaction(db, () => {
        const auditId = appendAudit(db, event);
        const step = executionStep === undefined ? undefined : db.prepare(`SELECT s.operation_id, s.execution_id, s.step_key, e.decision_id
          FROM operation_steps s JOIN operation_executions e ON e.id = s.execution_id
          WHERE s.execution_id = ? AND s.step_key = ?`).get(executionStep.executionId, executionStep.stepKey) as {
            operation_id: string; execution_id: string; step_key: string; decision_id: string;
          } | undefined;
        if (step !== undefined) db.prepare(`INSERT INTO operation_execution_audit_links
          (audit_id, operation_id, decision_id, execution_id, step_key, event_type)
          VALUES (?, ?, ?, ?, ?, 'meta_call')`)
          .run(auditId, step.operation_id, step.decision_id, step.execution_id, step.step_key);
        return auditId;
      }),
      ...(options.now === undefined ? {} : { now: options.now }),
    });
    const reporting = createReportingService({
      db,
      meta,
      cursorKey,
      ...(options.now === undefined ? {} : { now: options.now }),
    });
    const pacing = createPacingService({
      db,
      meta,
      ...(options.now === undefined ? {} : { now: options.now }),
    });
    const actor = options.actor ?? "openclaw";
    const mediaRoot = options.mediaRoot ?? join(dataRoot, "media");
    const media = await createMediaService({
      db,
      dataRoot,
      mediaRoot,
      ...(options.now === undefined ? {} : { now: options.now }),
    });
    await media.cleanupExpired();
    const operations = createOperationsService({
      db,
      hashMediaFile: media.hashFile,
      capabilities: async (input) => {
        const assets: Awaited<ReturnType<typeof reporting.getCapabilities>>["assets"] = [];
        let cursor: string | undefined;
        let snapshot: Awaited<ReturnType<typeof reporting.getCapabilities>> | undefined;
        do {
          snapshot = await reporting.getCapabilities({ ...input, limit: 100, ...(cursor === undefined ? {} : { cursor }) });
          assets.push(...snapshot.assets);
          cursor = snapshot.page.next_cursor ?? undefined;
        } while (cursor !== undefined);
        return { assets, capabilities: snapshot!.capabilities };
      },
      validateTarget: async (input) => {
        const discriminator = { campaign: "objective", ad_set: "optimization_goal", ad: "creative" } as const;
        try {
          const result = await meta.request<Record<string, unknown>>({
            method: "GET",
            path: `/${input.objectId}`,
            query: { fields: `id,account_id,${discriminator[input.objectType]}` },
            scope: input.scope,
            actor: input.actor,
            correlationId: input.requestId,
            operation: "validate_operation_target",
          });
          return validatedMetaTarget(result.data, {
            objectType: input.objectType,
            objectId: input.objectId,
            adAccountId: input.scope.adAccountId,
          });
        } catch (error) {
          if (isSemanticTargetFailure(error)) return undefined;
          throw error;
        }
      },
      ...(options.now === undefined ? {} : { now: options.now }),
    });
    const execution = createExecutionService({
      db,
      meta,
      revalidate: operations.revalidate,
      readMedia: media.readBound,
      cleanupOperationMedia: media.cleanupOperation,
      ...(options.now === undefined ? {} : { now: options.now }),
    });
    await execution.reconcile({ actor: "system:recovery", requestId: randomUUID() });
    const approval = createApprovalService({
      db,
      secrets,
      ownerIdentity: options.ownerIdentity,
      revalidate: operations.revalidate,
      cleanupOperationMedia: media.cleanupOperation,
      executeApproved: execution.execute,
      ...(options.now === undefined ? {} : { now: options.now }),
    });
    const application = options.buildApplication ?? buildApp;
    const app = await application({
      serviceToken: options.serviceToken,
      ...(options.now === undefined ? {} : { now: options.now }),
      handlers: {
        ...createReportingHandlers(reporting, actor),
        ...createPacingHandlers(pacing, actor),
        ...createMediaHandlers(media, actor),
        ...createOperationHandlers(operations, actor),
        ...createApprovalHandlers(approval, options.ownerIdentity),
      },
    });
    app.addHook("onClose", async () => closeDatabase());
    return app;
  } catch (error) {
    closeDatabase();
    throw error;
  }
}
