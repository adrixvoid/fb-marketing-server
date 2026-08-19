import type { DatabaseSync } from "node:sqlite";

export interface Migration {
  readonly version: number;
  up(db: DatabaseSync): void;
}

const initialSchema = `
  CREATE TABLE clients (
    id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    portfolio_id TEXT NOT NULL UNIQUE CHECK (length(trim(portfolio_id)) > 0),
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
  ) STRICT;

  CREATE TABLE integrations (
    id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    meta_app_id TEXT NOT NULL UNIQUE CHECK (length(trim(meta_app_id)) > 0),
    state TEXT NOT NULL CHECK (length(trim(state)) > 0),
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
  ) STRICT;

  CREATE TABLE integration_generations (
    id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
    integration_id TEXT NOT NULL REFERENCES integrations(id),
    generation TEXT NOT NULL CHECK (length(trim(generation)) > 0),
    status TEXT NOT NULL CHECK (length(trim(status)) > 0),
    validated_at TEXT,
    retired_at TEXT,
    UNIQUE (integration_id, generation)
  ) STRICT;

  CREATE TABLE ad_accounts (
    id TEXT NOT NULL CHECK (length(trim(id)) > 0),
    client_id TEXT NOT NULL REFERENCES clients(id),
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    currency TEXT,
    timezone TEXT,
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    PRIMARY KEY (id),
    UNIQUE (id, client_id),
    UNIQUE (id, client_id, currency)
  ) STRICT;

  CREATE TABLE scope_mappings (
    client_id TEXT NOT NULL REFERENCES clients(id),
    ad_account_id TEXT NOT NULL,
    generation_id TEXT NOT NULL REFERENCES integration_generations(id),
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    app_authorized INTEGER NOT NULL DEFAULT 0 CHECK (app_authorized IN (0, 1)),
    subject_authorized INTEGER NOT NULL DEFAULT 0 CHECK (subject_authorized IN (0, 1)),
    partner_authorized INTEGER NOT NULL DEFAULT 0 CHECK (partner_authorized IN (0, 1)),
    asset_authorized INTEGER NOT NULL DEFAULT 0 CHECK (asset_authorized IN (0, 1)),
    granted_tasks TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(granted_tasks) AND json_type(granted_tasks) = 'array'),
    PRIMARY KEY (client_id, ad_account_id, generation_id),
    FOREIGN KEY (ad_account_id, client_id) REFERENCES ad_accounts(id, client_id)
  ) STRICT;

  CREATE UNIQUE INDEX one_active_scope_generation
    ON scope_mappings(client_id, ad_account_id) WHERE active = 1;

  CREATE TABLE encrypted_credentials (
    id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
    generation_id TEXT NOT NULL REFERENCES integration_generations(id),
    subject_id TEXT NOT NULL CHECK (length(trim(subject_id)) > 0),
    key_ref TEXT NOT NULL CHECK (length(trim(key_ref)) > 0),
    envelope_version INTEGER NOT NULL CHECK (envelope_version = 1),
    ciphertext TEXT NOT NULL CHECK (length(ciphertext) > 0),
    iv TEXT NOT NULL CHECK (length(iv) > 0),
    auth_tag TEXT NOT NULL CHECK (length(auth_tag) > 0),
    scopes TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(scopes) AND json_type(scopes) = 'array'),
    status TEXT NOT NULL CHECK (length(trim(status)) > 0),
    validated_at TEXT,
    revoked_at TEXT
  ) STRICT;

  CREATE UNIQUE INDEX one_active_generation_credential
    ON encrypted_credentials(generation_id) WHERE status = 'active';

  CREATE TABLE budgets (
    client_id TEXT NOT NULL,
    ad_account_id TEXT NOT NULL,
    amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0 AND amount_minor <= 9007199254740991),
    currency TEXT NOT NULL CHECK (length(trim(currency)) > 0),
    updated_at TEXT NOT NULL CHECK (datetime(updated_at) IS NOT NULL),
    PRIMARY KEY (client_id, ad_account_id),
    FOREIGN KEY (ad_account_id, client_id, currency) REFERENCES ad_accounts(id, client_id, currency)
  ) STRICT;

  CREATE TABLE audit_log (
    id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
    actor TEXT NOT NULL CHECK (length(trim(actor)) > 0),
    client_id TEXT,
    ad_account_id TEXT,
    generation_id TEXT,
    logical_operation TEXT NOT NULL CHECK (length(trim(logical_operation)) > 0),
    correlation_id TEXT NOT NULL CHECK (length(trim(correlation_id)) > 0),
    occurred_at TEXT NOT NULL CHECK (
      occurred_at GLOB '????-??-??T??:??:??.???Z' AND datetime(occurred_at) IS NOT NULL
    ),
    outcome TEXT NOT NULL CHECK (outcome IN ('started', 'succeeded', 'failed')),
    evidence TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(evidence) AND json_type(evidence) = 'object'),
    CHECK (
      (client_id IS NULL AND ad_account_id IS NULL AND generation_id IS NULL) OR
      (client_id IS NOT NULL AND ad_account_id IS NOT NULL AND generation_id IS NOT NULL)
    ),
    FOREIGN KEY (client_id, ad_account_id, generation_id)
      REFERENCES scope_mappings(client_id, ad_account_id, generation_id)
  ) STRICT;

  CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
  BEGIN SELECT RAISE(ABORT, 'audit_log is immutable'); END;
  CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log
  BEGIN SELECT RAISE(ABORT, 'audit_log is immutable'); END;
`;

const unitFourSchema = `
  CREATE TABLE staged_media (
    id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
    client_id TEXT NOT NULL,
    ad_account_id TEXT NOT NULL,
    generation_id TEXT NOT NULL,
    sha256 TEXT NOT NULL CHECK (length(sha256) = 64 AND sha256 NOT GLOB '*[^a-f0-9]*'),
    media_type TEXT NOT NULL CHECK (media_type IN ('image', 'video')),
    content_type TEXT NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'video/mp4')),
    size_bytes INTEGER NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 26214400),
    original_filename TEXT NOT NULL CHECK (
      length(original_filename) BETWEEN 1 AND 255 AND
      instr(original_filename, '/') = 0 AND instr(original_filename, char(92)) = 0
    ),
    attachment_id TEXT NOT NULL CHECK (length(trim(attachment_id)) > 0),
    alt_text TEXT CHECK (length(alt_text) <= 1000),
    actor TEXT NOT NULL CHECK (length(trim(actor)) > 0),
    correlation_id TEXT NOT NULL CHECK (length(trim(correlation_id)) > 0),
    storage_name TEXT NOT NULL UNIQUE CHECK (
      length(storage_name) = 36 AND instr(storage_name, '/') = 0 AND instr(storage_name, char(92)) = 0
    ),
    status TEXT NOT NULL CHECK (status IN ('staged', 'bound', 'consumed', 'expired', 'invalid')),
    created_at TEXT NOT NULL CHECK (datetime(created_at) IS NOT NULL),
    expires_at TEXT NOT NULL CHECK (datetime(expires_at) IS NOT NULL AND expires_at > created_at),
    UNIQUE (id, sha256, client_id, ad_account_id),
    FOREIGN KEY (client_id, ad_account_id, generation_id)
      REFERENCES scope_mappings(client_id, ad_account_id, generation_id)
  ) STRICT;

  CREATE INDEX staged_media_expiry ON staged_media(status, expires_at);
  CREATE TRIGGER staged_media_immutable
    BEFORE UPDATE OF client_id, ad_account_id, generation_id, sha256, media_type, content_type,
      size_bytes, original_filename, attachment_id, alt_text, actor, correlation_id,
      storage_name, created_at, expires_at ON staged_media
  BEGIN SELECT RAISE(ABORT, 'staged media identity is immutable'); END;
  CREATE TRIGGER staged_media_status_transition
    BEFORE UPDATE OF status ON staged_media
    WHEN NOT (
      OLD.status = NEW.status OR
      (OLD.status = 'staged' AND NEW.status IN ('bound', 'expired', 'invalid')) OR
      (OLD.status = 'bound' AND NEW.status IN ('consumed', 'expired', 'invalid'))
    )
  BEGIN SELECT RAISE(ABORT, 'invalid staged media status transition'); END;
  CREATE TRIGGER staged_media_no_delete BEFORE DELETE ON staged_media
  BEGIN SELECT RAISE(ABORT, 'staged media history is immutable'); END;

  CREATE TABLE operations (
    id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
    actor TEXT NOT NULL CHECK (length(trim(actor)) > 0),
    client_id TEXT NOT NULL,
    ad_account_id TEXT NOT NULL,
    generation_id TEXT NOT NULL,
    operation_type TEXT NOT NULL CHECK (operation_type IN (
      'create_campaign_bundle', 'update_object', 'change_delivery', 'configure_monthly_budget'
    )),
    payload_json TEXT NOT NULL CHECK (json_valid(payload_json) AND json_type(payload_json) = 'object'),
    payload_hash TEXT NOT NULL CHECK (length(payload_hash) = 64 AND payload_hash NOT GLOB '*[^a-f0-9]*'),
    derived_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(derived_json) AND json_type(derived_json) = 'object'),
    status TEXT NOT NULL CHECK (status IN ('pending', 'executing', 'succeeded', 'rejected', 'expired', 'stale', 'failed')),
    result_json TEXT CHECK (result_json IS NULL OR (json_valid(result_json) AND json_type(result_json) = 'object')),
    created_at TEXT NOT NULL CHECK (datetime(created_at) IS NOT NULL),
    expires_at TEXT NOT NULL CHECK (datetime(expires_at) IS NOT NULL AND expires_at > created_at),
    UNIQUE (id, payload_hash),
    UNIQUE (id, client_id, ad_account_id),
    FOREIGN KEY (client_id, ad_account_id, generation_id)
      REFERENCES scope_mappings(client_id, ad_account_id, generation_id)
  ) STRICT;

  CREATE INDEX operations_scope_status ON operations(client_id, ad_account_id, status, expires_at);
  CREATE TRIGGER operations_immutable
    BEFORE UPDATE OF id, actor, client_id, ad_account_id, generation_id, operation_type,
      payload_json, payload_hash, derived_json, created_at, expires_at ON operations
  BEGIN SELECT RAISE(ABORT, 'operation proposal is immutable'); END;
  CREATE TRIGGER operations_no_delete BEFORE DELETE ON operations
  BEGIN SELECT RAISE(ABORT, 'operation history is immutable'); END;

  CREATE TABLE operation_idempotency (
    actor TEXT NOT NULL CHECK (length(trim(actor)) > 0),
    operation_type TEXT NOT NULL,
    client_id TEXT NOT NULL,
    ad_account_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 16 AND 128),
    payload_hash TEXT NOT NULL,
    operation_id TEXT NOT NULL,
    created_at TEXT NOT NULL CHECK (datetime(created_at) IS NOT NULL),
    PRIMARY KEY (actor, operation_type, client_id, ad_account_id, idempotency_key),
    UNIQUE (operation_id),
    FOREIGN KEY (operation_id, payload_hash) REFERENCES operations(id, payload_hash)
  ) STRICT;
  CREATE TRIGGER operation_idempotency_no_update BEFORE UPDATE ON operation_idempotency
  BEGIN SELECT RAISE(ABORT, 'operation idempotency is immutable'); END;
  CREATE TRIGGER operation_idempotency_no_delete BEFORE DELETE ON operation_idempotency
  BEGIN SELECT RAISE(ABORT, 'operation idempotency is immutable'); END;

  CREATE TABLE operation_media (
    operation_id TEXT NOT NULL,
    media_id TEXT NOT NULL,
    media_hash TEXT NOT NULL,
    client_id TEXT NOT NULL,
    ad_account_id TEXT NOT NULL,
    PRIMARY KEY (operation_id, media_id),
    UNIQUE (media_id),
    FOREIGN KEY (operation_id, client_id, ad_account_id) REFERENCES operations(id, client_id, ad_account_id),
    FOREIGN KEY (media_id, media_hash, client_id, ad_account_id)
      REFERENCES staged_media(id, sha256, client_id, ad_account_id)
  ) STRICT;
  CREATE TRIGGER operation_media_no_update BEFORE UPDATE ON operation_media
  BEGIN SELECT RAISE(ABORT, 'operation media binding is immutable'); END;
  CREATE TRIGGER operation_media_no_delete BEFORE DELETE ON operation_media
  BEGIN SELECT RAISE(ABORT, 'operation media binding is immutable'); END;

  CREATE TABLE proof_nonces (
    nonce TEXT PRIMARY KEY CHECK (length(nonce) BETWEEN 22 AND 64),
    owner_identity TEXT NOT NULL CHECK (length(trim(owner_identity)) > 0),
    operation_id TEXT NOT NULL REFERENCES operations(id),
    decision TEXT NOT NULL CHECK (decision IN ('approved', 'rejected')),
    body_hash TEXT NOT NULL CHECK (length(body_hash) = 64 AND body_hash NOT GLOB '*[^a-f0-9]*'),
    issued_at INTEGER NOT NULL CHECK (issued_at >= 0),
    consumed_at TEXT NOT NULL CHECK (datetime(consumed_at) IS NOT NULL),
    correlation_id TEXT NOT NULL CHECK (length(trim(correlation_id)) > 0),
    UNIQUE (nonce, operation_id, decision)
  ) STRICT;
  CREATE TRIGGER proof_nonces_no_update BEFORE UPDATE ON proof_nonces
  BEGIN SELECT RAISE(ABORT, 'proof nonce is immutable'); END;
  CREATE TRIGGER proof_nonces_no_delete BEFORE DELETE ON proof_nonces
  BEGIN SELECT RAISE(ABORT, 'proof nonce is immutable'); END;

  CREATE TABLE approval_decisions (
    id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
    operation_id TEXT NOT NULL UNIQUE,
    payload_hash TEXT NOT NULL,
    decision TEXT NOT NULL CHECK (decision IN ('approved', 'rejected')),
    owner_identity TEXT NOT NULL CHECK (length(trim(owner_identity)) > 0),
    decided_at TEXT NOT NULL CHECK (datetime(decided_at) IS NOT NULL),
    nonce TEXT NOT NULL UNIQUE,
    correlation_id TEXT NOT NULL CHECK (length(trim(correlation_id)) > 0),
    UNIQUE (id, operation_id),
    FOREIGN KEY (operation_id, payload_hash) REFERENCES operations(id, payload_hash),
    FOREIGN KEY (nonce, operation_id, decision) REFERENCES proof_nonces(nonce, operation_id, decision)
  ) STRICT;
  CREATE TRIGGER approval_decisions_pending_only BEFORE INSERT ON approval_decisions
    WHEN (SELECT status FROM operations WHERE id = NEW.operation_id) <> 'pending'
  BEGIN SELECT RAISE(ABORT, 'approval decision requires a pending operation'); END;
  CREATE TRIGGER approval_decisions_no_update BEFORE UPDATE ON approval_decisions
  BEGIN SELECT RAISE(ABORT, 'approval decision is immutable'); END;
  CREATE TRIGGER approval_decisions_no_delete BEFORE DELETE ON approval_decisions
  BEGIN SELECT RAISE(ABORT, 'approval decision is immutable'); END;

  CREATE TABLE operation_audit_links (
    audit_id TEXT PRIMARY KEY REFERENCES audit_log(id),
    operation_id TEXT NOT NULL REFERENCES operations(id),
    decision_id TEXT,
    event_type TEXT NOT NULL CHECK (event_type IN ('proposal', 'decision', 'revalidation')),
    FOREIGN KEY (decision_id, operation_id) REFERENCES approval_decisions(id, operation_id)
  ) STRICT;
  CREATE TRIGGER operation_audit_links_no_update BEFORE UPDATE ON operation_audit_links
  BEGIN SELECT RAISE(ABORT, 'operation audit link is immutable'); END;
  CREATE TRIGGER operation_audit_links_no_delete BEFORE DELETE ON operation_audit_links
  BEGIN SELECT RAISE(ABORT, 'operation audit link is immutable'); END;

  CREATE TRIGGER operations_status_transition
    BEFORE UPDATE OF status ON operations
    WHEN NOT (
      OLD.status = NEW.status OR
      (OLD.status = 'pending' AND NEW.status IN ('executing', 'rejected', 'expired', 'stale')) OR
      (OLD.status = 'executing' AND NEW.status IN ('succeeded', 'failed', 'stale'))
    )
  BEGIN SELECT RAISE(ABORT, 'invalid operation status transition'); END;
`;

export const migrations: readonly Migration[] = [
  { version: 1, up: (db) => db.exec(initialSchema) },
  { version: 2, up: (db) => db.exec(unitFourSchema) },
];

export function runMigrations(db: DatabaseSync, pending: readonly Migration[] = migrations): void {
  const ordered = [...pending].sort((a, b) => a.version - b.version);
  if (ordered.some(({ version }, index) => !Number.isSafeInteger(version) || version < 1 || version === ordered[index - 1]?.version)) {
    throw new Error("Invalid migration sequence");
  }

  let current = Number(db.prepare("PRAGMA user_version").get()!.user_version);
  const latest = ordered.at(-1)?.version ?? 0;
  if (!Number.isSafeInteger(current) || current < 0 || current > latest) {
    throw new Error(`Unsupported database version ${current}`);
  }

  for (const migration of ordered) {
    if (migration.version <= current) continue;
    if (migration.version !== current + 1) throw new Error(`Missing migration ${current + 1}`);

    db.exec("BEGIN IMMEDIATE");
    try {
      migration.up(db);
      db.exec(`PRAGMA user_version = ${migration.version}`);
      db.exec("COMMIT");
      current = migration.version;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
}
