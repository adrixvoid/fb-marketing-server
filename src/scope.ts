import type { DatabaseSync } from "node:sqlite";

export interface ScopeInput {
  clientId: string;
  adAccountId: string;
}

export interface ScopeAuthority {
  task?: string;
  permission?: string;
}

export interface ResolvedScope extends ScopeInput {
  clientName: string;
  adAccountName: string;
  currency?: string;
  timezone?: string;
  integrationId: string;
  generationId: string;
  credentialId: string;
}

interface ScopeRow {
  client_id: string;
  client_name: string;
  ad_account_id: string;
  ad_account_name: string;
  currency: string | null;
  timezone: string | null;
  integration_id: string;
  generation_id: string;
  credential_id: string;
  granted_tasks: string;
  scopes: string;
}

const scopeQuery = `
  SELECT c.id AS client_id, c.name AS client_name,
         a.id AS ad_account_id, a.name AS ad_account_name, a.currency, a.timezone,
         i.id AS integration_id, g.id AS generation_id, ec.id AS credential_id,
         sm.granted_tasks, ec.scopes
    FROM scope_mappings sm
    JOIN clients c ON c.id = sm.client_id AND c.active = 1
    JOIN ad_accounts a ON a.id = sm.ad_account_id AND a.client_id = c.id AND a.active = 1
    JOIN integration_generations g ON g.id = sm.generation_id
      AND g.status = 'active' AND g.validated_at IS NOT NULL AND g.retired_at IS NULL
    JOIN integrations i ON i.id = g.integration_id AND i.active = 1 AND i.state = 'active'
    JOIN encrypted_credentials ec ON ec.generation_id = g.id
      AND ec.status = 'active' AND ec.validated_at IS NOT NULL AND ec.revoked_at IS NULL
   WHERE sm.client_id = ? AND sm.ad_account_id = ? AND sm.active = 1
     AND sm.app_authorized = 1 AND sm.subject_authorized = 1
     AND sm.partner_authorized = 1 AND sm.asset_authorized = 1
`;

export function resolveScope(db: DatabaseSync, input: ScopeInput, authority: ScopeAuthority = {}): ResolvedScope {
  if (!input.clientId || !input.adAccountId) throw new Error("Explicit client_id and ad_account_id are required");
  const rows = db.prepare(scopeQuery).all(input.clientId, input.adAccountId) as unknown as ScopeRow[];
  if (rows.length !== 1) throw new Error("Scope is not authorized");
  const row = rows[0]!;
  const tasks = JSON.parse(row.granted_tasks) as unknown;
  const permissions = JSON.parse(row.scopes) as unknown;
  if (
    (authority.task !== undefined && (!Array.isArray(tasks) || !tasks.includes(authority.task))) ||
    (authority.permission !== undefined && (!Array.isArray(permissions) || !permissions.includes(authority.permission)))
  ) {
    throw new Error("Scope is not authorized");
  }

  return {
    clientId: row.client_id,
    clientName: row.client_name,
    adAccountId: row.ad_account_id,
    adAccountName: row.ad_account_name,
    ...(row.currency === null ? {} : { currency: row.currency }),
    ...(row.timezone === null ? {} : { timezone: row.timezone }),
    integrationId: row.integration_id,
    generationId: row.generation_id,
    credentialId: row.credential_id,
  };
}

export async function withResolvedScope<T>(
  db: DatabaseSync,
  input: ScopeInput,
  authority: ScopeAuthority,
  work: (scope: ResolvedScope) => Promise<T> | T,
): Promise<T> {
  return work(resolveScope(db, input, authority));
}
