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
    generation_id TEXT NOT NULL CHECK (length(trim(generation_id)) > 0),
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
    created_at TEXT NOT NULL CHECK (created_at GLOB '????-??-??T??:??:??.???Z' AND datetime(created_at) IS NOT NULL),
    expires_at TEXT NOT NULL CHECK (expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at, '+12 hours')),
    UNIQUE (id, sha256, client_id, ad_account_id),
    FOREIGN KEY (client_id, ad_account_id, generation_id)
      REFERENCES scope_mappings(client_id, ad_account_id, generation_id)
  ) STRICT;

  CREATE INDEX staged_media_expiry ON staged_media(status, expires_at);
  CREATE TRIGGER staged_media_positive_generation BEFORE INSERT ON staged_media
    WHEN NOT EXISTS (
      SELECT 1 FROM integration_generations g WHERE g.id = NEW.generation_id AND CAST(g.generation AS INTEGER) > 0
    )
  BEGIN SELECT RAISE(ABORT, 'staged media generation must be positive'); END;
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
    generation_id TEXT NOT NULL CHECK (length(trim(generation_id)) > 0),
    operation_type TEXT NOT NULL CHECK (operation_type IN (
      'create_campaign_bundle', 'update_object', 'change_delivery', 'configure_monthly_budget'
    )),
    payload_json TEXT NOT NULL CHECK (json_valid(payload_json) AND json_type(payload_json) = 'object'),
    payload_hash TEXT NOT NULL CHECK (length(payload_hash) = 64 AND payload_hash NOT GLOB '*[^a-f0-9]*'),
    derived_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(derived_json) AND json_type(derived_json) = 'object'),
    status TEXT NOT NULL CHECK (status IN ('pending', 'executing', 'succeeded', 'rejected', 'expired', 'stale', 'failed')),
    result_json TEXT CHECK (
      (status IN ('pending', 'executing', 'rejected', 'expired', 'stale') AND result_json IS NULL) OR
      (status IN ('succeeded', 'failed') AND result_json IS NOT NULL AND json_valid(result_json) AND json_type(result_json) = 'object')
    ),
    created_at TEXT NOT NULL CHECK (created_at GLOB '????-??-??T??:??:??.???Z' AND datetime(created_at) IS NOT NULL),
    expires_at TEXT NOT NULL CHECK (expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at, '+12 hours')),
    UNIQUE (id, payload_hash),
    UNIQUE (id, client_id, ad_account_id),
    FOREIGN KEY (client_id, ad_account_id, generation_id)
      REFERENCES scope_mappings(client_id, ad_account_id, generation_id)
  ) STRICT;

  CREATE INDEX operations_scope_status ON operations(client_id, ad_account_id, status, expires_at);
  CREATE UNIQUE INDEX operations_idempotency_identity
    ON operations(id, payload_hash, actor, operation_type, client_id, ad_account_id);
  CREATE TRIGGER operations_positive_generation BEFORE INSERT ON operations
    WHEN NOT EXISTS (
      SELECT 1 FROM integration_generations g WHERE g.id = NEW.generation_id AND CAST(g.generation AS INTEGER) > 0
    )
  BEGIN SELECT RAISE(ABORT, 'operation generation must be positive'); END;
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
  CREATE TRIGGER operation_idempotency_identity_insert BEFORE INSERT ON operation_idempotency
    WHEN NOT EXISTS (
      SELECT 1 FROM operations o WHERE o.id = NEW.operation_id AND o.payload_hash = NEW.payload_hash
        AND o.actor = NEW.actor AND o.operation_type = NEW.operation_type
        AND o.client_id = NEW.client_id AND o.ad_account_id = NEW.ad_account_id
    )
  BEGIN SELECT RAISE(ABORT, 'operation idempotency identity mismatch'); END;
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
  CREATE INDEX proof_nonces_operation ON proof_nonces(operation_id);
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

const unitFourRemediation = `
  CREATE INDEX IF NOT EXISTS approval_failed_audit_limit ON audit_log(logical_operation, outcome);
  CREATE INDEX IF NOT EXISTS proof_nonces_operation ON proof_nonces(operation_id);
  CREATE UNIQUE INDEX IF NOT EXISTS operations_idempotency_identity
    ON operations(id, payload_hash, actor, operation_type, client_id, ad_account_id);
  CREATE TRIGGER IF NOT EXISTS staged_media_positive_generation BEFORE INSERT ON staged_media
    WHEN NOT EXISTS (
      SELECT 1 FROM integration_generations g WHERE g.id = NEW.generation_id AND CAST(g.generation AS INTEGER) > 0
    )
  BEGIN SELECT RAISE(ABORT, 'staged media generation must be positive'); END;
  CREATE TRIGGER IF NOT EXISTS staged_media_exact_expiry_insert BEFORE INSERT ON staged_media
    WHEN NEW.expires_at <> strftime('%Y-%m-%dT%H:%M:%fZ', NEW.created_at, '+12 hours')
  BEGIN SELECT RAISE(ABORT, 'staged media expiry must be exactly 12 hours'); END;
  CREATE TRIGGER IF NOT EXISTS operations_positive_generation BEFORE INSERT ON operations
    WHEN NOT EXISTS (
      SELECT 1 FROM integration_generations g WHERE g.id = NEW.generation_id AND CAST(g.generation AS INTEGER) > 0
    )
  BEGIN SELECT RAISE(ABORT, 'operation generation must be positive'); END;
  CREATE TRIGGER IF NOT EXISTS operations_invariants_insert BEFORE INSERT ON operations
    WHEN NEW.expires_at <> strftime('%Y-%m-%dT%H:%M:%fZ', NEW.created_at, '+12 hours') OR NOT (
      (NEW.status IN ('pending', 'executing', 'rejected', 'expired', 'stale') AND NEW.result_json IS NULL) OR
      (NEW.status IN ('succeeded', 'failed') AND NEW.result_json IS NOT NULL AND json_valid(NEW.result_json) AND json_type(NEW.result_json) = 'object')
    )
  BEGIN SELECT RAISE(ABORT, 'invalid operation expiry or result'); END;
  CREATE TRIGGER IF NOT EXISTS operations_result_update BEFORE UPDATE OF status, result_json ON operations
    WHEN NOT (
      (NEW.status IN ('pending', 'executing', 'rejected', 'expired', 'stale') AND NEW.result_json IS NULL) OR
      (NEW.status IN ('succeeded', 'failed') AND NEW.result_json IS NOT NULL AND json_valid(NEW.result_json) AND json_type(NEW.result_json) = 'object')
    )
  BEGIN SELECT RAISE(ABORT, 'invalid operation result'); END;
  CREATE TRIGGER IF NOT EXISTS operation_idempotency_identity_insert BEFORE INSERT ON operation_idempotency
    WHEN NOT EXISTS (
      SELECT 1 FROM operations o WHERE o.id = NEW.operation_id AND o.payload_hash = NEW.payload_hash
        AND o.actor = NEW.actor AND o.operation_type = NEW.operation_type
        AND o.client_id = NEW.client_id AND o.ad_account_id = NEW.ad_account_id
    )
  BEGIN SELECT RAISE(ABORT, 'operation idempotency identity mismatch'); END;
`;

const approvalRetentionRemediation = `
  DROP TRIGGER proof_nonces_no_update;
  DROP TRIGGER proof_nonces_no_delete;
  ALTER TABLE proof_nonces ADD COLUMN purge_after INTEGER;
  UPDATE proof_nonces SET purge_after = issued_at + 300;
  CREATE TABLE approval_nonce_maintenance (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    purge_before INTEGER NOT NULL CHECK (purge_before >= 0)
  ) STRICT;
  INSERT INTO approval_nonce_maintenance (id, purge_before) VALUES (1, 0);
  CREATE TRIGGER approval_nonce_maintenance_no_delete BEFORE DELETE ON approval_nonce_maintenance
  BEGIN SELECT RAISE(ABORT, 'approval nonce maintenance state is required'); END;
  CREATE TRIGGER proof_nonces_retention_insert BEFORE INSERT ON proof_nonces
    WHEN NEW.purge_after IS NULL OR NEW.purge_after < NEW.issued_at
  BEGIN SELECT RAISE(ABORT, 'proof nonce replay horizon is required'); END;
  CREATE TRIGGER proof_nonces_no_update BEFORE UPDATE ON proof_nonces
  BEGIN SELECT RAISE(ABORT, 'proof nonce is immutable'); END;
  CREATE TRIGGER proof_nonces_controlled_delete BEFORE DELETE ON proof_nonces
    WHEN OLD.purge_after IS NULL OR OLD.purge_after >= (SELECT purge_before FROM approval_nonce_maintenance WHERE id = 1) OR
      EXISTS (SELECT 1 FROM approval_decisions d WHERE d.nonce = OLD.nonce)
  BEGIN SELECT RAISE(ABORT, 'proof nonce decision evidence or replay horizon prevents deletion'); END;
  CREATE INDEX proof_nonces_purge ON proof_nonces(purge_after);

  CREATE TABLE approval_rate_limits (
    scope TEXT NOT NULL CHECK (scope IN ('global', 'owner')),
    identity TEXT NOT NULL CHECK (length(trim(identity)) > 0),
    window_started_at INTEGER NOT NULL CHECK (window_started_at >= 0),
    admitted_count INTEGER NOT NULL CHECK (admitted_count >= 0),
    rejected_count INTEGER NOT NULL CHECK (rejected_count >= 0),
    last_rejected_at INTEGER CHECK (last_rejected_at IS NULL OR last_rejected_at >= window_started_at),
    PRIMARY KEY (scope),
    CHECK ((scope = 'global' AND identity = '*') OR scope = 'owner')
  ) STRICT;
  CREATE TRIGGER approval_rate_limits_no_delete BEFORE DELETE ON approval_rate_limits
  BEGIN SELECT RAISE(ABORT, 'approval rate-limit evidence is durable'); END;
`;

const unitFiveSchema = `
  CREATE TABLE operation_executions (
    id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
    operation_id TEXT NOT NULL UNIQUE,
    decision_id TEXT NOT NULL UNIQUE,
    payload_hash TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('running', 'reconciliation_required', 'succeeded', 'failed')),
    claimed_at TEXT NOT NULL CHECK (datetime(claimed_at) IS NOT NULL),
    completed_at TEXT CHECK (completed_at IS NULL OR datetime(completed_at) IS NOT NULL),
    correlation_id TEXT NOT NULL CHECK (length(trim(correlation_id)) > 0),
    UNIQUE (id, operation_id),
    FOREIGN KEY (operation_id, payload_hash) REFERENCES operations(id, payload_hash),
    FOREIGN KEY (decision_id, operation_id) REFERENCES approval_decisions(id, operation_id),
    CHECK (
      (status IN ('running', 'reconciliation_required') AND completed_at IS NULL) OR
      (status IN ('succeeded', 'failed') AND completed_at IS NOT NULL)
    )
  ) STRICT;
  CREATE TRIGGER operation_executions_approved_pending_insert BEFORE INSERT ON operation_executions
    WHEN NOT EXISTS (
      SELECT 1 FROM operations o JOIN approval_decisions d ON d.operation_id = o.id
      WHERE o.id = NEW.operation_id AND o.payload_hash = NEW.payload_hash AND o.status = 'pending'
        AND d.id = NEW.decision_id AND d.decision = 'approved'
    )
  BEGIN SELECT RAISE(ABORT, 'execution claim requires an approved pending operation'); END;
  CREATE TRIGGER operation_executions_immutable
    BEFORE UPDATE OF id, operation_id, decision_id, payload_hash, claimed_at, correlation_id ON operation_executions
  BEGIN SELECT RAISE(ABORT, 'operation execution identity is immutable'); END;
  CREATE TRIGGER operation_executions_transition BEFORE UPDATE OF status, completed_at ON operation_executions
    WHEN NOT (
      OLD.status = 'running' AND NEW.status IN ('reconciliation_required', 'succeeded', 'failed')
    ) OR NOT (
      (NEW.status IN ('running', 'reconciliation_required') AND NEW.completed_at IS NULL) OR
      (NEW.status IN ('succeeded', 'failed') AND NEW.completed_at IS NOT NULL)
    )
  BEGIN SELECT RAISE(ABORT, 'invalid operation execution transition'); END;
  CREATE TRIGGER operation_executions_no_delete BEFORE DELETE ON operation_executions
  BEGIN SELECT RAISE(ABORT, 'operation execution history is immutable'); END;

  CREATE TABLE operation_steps (
    execution_id TEXT NOT NULL,
    operation_id TEXT NOT NULL,
    step_key TEXT NOT NULL CHECK (length(trim(step_key)) > 0),
    sequence INTEGER NOT NULL CHECK (sequence >= 0),
    kind TEXT NOT NULL CHECK (kind IN (
      'image', 'video', 'campaign', 'ad_set', 'creative', 'ad',
      'update_object', 'change_delivery', 'configure_monthly_budget'
    )),
    status TEXT NOT NULL CHECK (status IN ('intent', 'succeeded', 'failed', 'reconciliation_required')),
    request_hash TEXT NOT NULL CHECK (length(request_hash) = 64 AND request_hash NOT GLOB '*[^a-f0-9]*'),
    correlation_id TEXT NOT NULL UNIQUE CHECK (length(trim(correlation_id)) > 0),
    external_id TEXT CHECK (external_id IS NULL OR length(trim(external_id)) > 0),
    error_code TEXT CHECK (error_code IS NULL OR length(trim(error_code)) > 0),
    attempted_at TEXT NOT NULL CHECK (datetime(attempted_at) IS NOT NULL),
    completed_at TEXT CHECK (completed_at IS NULL OR datetime(completed_at) IS NOT NULL),
    PRIMARY KEY (execution_id, step_key),
    UNIQUE (execution_id, sequence),
    FOREIGN KEY (execution_id, operation_id) REFERENCES operation_executions(id, operation_id),
    CHECK (
      (status = 'intent' AND external_id IS NULL AND error_code IS NULL AND completed_at IS NULL) OR
      (status = 'succeeded' AND external_id IS NOT NULL AND error_code IS NULL AND completed_at IS NOT NULL) OR
      (status IN ('failed', 'reconciliation_required') AND external_id IS NULL AND error_code IS NOT NULL AND completed_at IS NOT NULL)
    )
  ) STRICT;
  CREATE TRIGGER operation_steps_intent_insert BEFORE INSERT ON operation_steps
    WHEN NEW.status <> 'intent'
  BEGIN SELECT RAISE(ABORT, 'operation step requires a persisted write intent'); END;
  CREATE TRIGGER operation_steps_immutable
    BEFORE UPDATE OF execution_id, operation_id, step_key, sequence, kind, request_hash, correlation_id, attempted_at ON operation_steps
  BEGIN SELECT RAISE(ABORT, 'operation step identity is immutable'); END;
  CREATE TRIGGER operation_steps_transition BEFORE UPDATE OF status, external_id, error_code, completed_at ON operation_steps
    WHEN OLD.status <> 'intent' OR NEW.status NOT IN ('succeeded', 'failed', 'reconciliation_required')
  BEGIN SELECT RAISE(ABORT, 'invalid operation step transition'); END;
  CREATE TRIGGER operation_steps_no_delete BEFORE DELETE ON operation_steps
  BEGIN SELECT RAISE(ABORT, 'operation step history is immutable'); END;

  CREATE TABLE operation_execution_audit_links (
    audit_id TEXT PRIMARY KEY REFERENCES audit_log(id),
    operation_id TEXT NOT NULL,
    decision_id TEXT NOT NULL,
    execution_id TEXT NOT NULL,
    step_key TEXT,
    event_type TEXT NOT NULL CHECK (event_type IN ('meta_call', 'execution')),
    FOREIGN KEY (decision_id, operation_id) REFERENCES approval_decisions(id, operation_id),
    FOREIGN KEY (execution_id, operation_id) REFERENCES operation_executions(id, operation_id),
    FOREIGN KEY (execution_id, step_key) REFERENCES operation_steps(execution_id, step_key)
  ) STRICT;
  CREATE TRIGGER operation_execution_audit_links_no_update BEFORE UPDATE ON operation_execution_audit_links
  BEGIN SELECT RAISE(ABORT, 'operation execution audit link is immutable'); END;
  CREATE TRIGGER operation_execution_audit_links_no_delete BEFORE DELETE ON operation_execution_audit_links
  BEGIN SELECT RAISE(ABORT, 'operation execution audit link is immutable'); END;
`;

function terminalResultIsValid(row: string): string {
  const result = `${row}.result_json`;
  return `CASE WHEN json_valid(${result}) = 1 AND json_type(${result}) = 'object' THEN CASE
    WHEN ${row}.status = 'succeeded' THEN CASE WHEN
      json_type(${result}, '$.status') = 'text' AND json_extract(${result}, '$.status') = 'succeeded' AND
      json_type(${result}, '$.completed_at') = 'text' AND datetime(json_extract(${result}, '$.completed_at')) IS NOT NULL AND
      json_type(${result}, '$.next_action') = 'text' AND json_extract(${result}, '$.next_action') = 'no_action' AND (
        (${row}.operation_type = 'create_campaign_bundle' AND (SELECT count(*) FROM json_each(${result})) = 7 AND
          json_type(${result}, '$.campaign') = 'object' AND (SELECT count(*) FROM json_each(${result}, '$.campaign')) = 2 AND
          json_type(${result}, '$.campaign.object_id') = 'text' AND length(trim(json_extract(${result}, '$.campaign.object_id'))) BETWEEN 1 AND 255 AND
          EXISTS (SELECT 1 FROM operation_executions e JOIN operation_steps s ON s.execution_id = e.id
            WHERE e.operation_id = ${row}.id AND s.step_key = 'campaign' AND s.kind = 'campaign' AND s.status = 'succeeded'
              AND s.external_id = json_extract(${result}, '$.campaign.object_id')) AND
          json_type(${result}, '$.campaign.delivery_status') = 'text' AND json_extract(${result}, '$.campaign.delivery_status') = 'PAUSED' AND
          json_type(${result}, '$.ad_set') = 'object' AND (SELECT count(*) FROM json_each(${result}, '$.ad_set')) = 2 AND
          json_type(${result}, '$.ad_set.object_id') = 'text' AND length(trim(json_extract(${result}, '$.ad_set.object_id'))) BETWEEN 1 AND 255 AND
          EXISTS (SELECT 1 FROM operation_executions e JOIN operation_steps s ON s.execution_id = e.id
            WHERE e.operation_id = ${row}.id AND s.step_key = 'ad_set' AND s.kind = 'ad_set' AND s.status = 'succeeded'
              AND s.external_id = json_extract(${result}, '$.ad_set.object_id')) AND
          json_type(${result}, '$.ad_set.delivery_status') = 'text' AND json_extract(${result}, '$.ad_set.delivery_status') = 'PAUSED' AND
          json_type(${result}, '$.creative') = 'object' AND (SELECT count(*) FROM json_each(${result}, '$.creative')) = 2 AND
          json_type(${result}, '$.creative.object_id') = 'text' AND length(trim(json_extract(${result}, '$.creative.object_id'))) BETWEEN 1 AND 255 AND
          EXISTS (SELECT 1 FROM operation_executions e JOIN operation_steps s ON s.execution_id = e.id
            WHERE e.operation_id = ${row}.id AND s.step_key = 'creative' AND s.kind = 'creative' AND s.status = 'succeeded'
              AND s.external_id = json_extract(${result}, '$.creative.object_id')) AND
          json_type(${result}, '$.creative.bound') = 'true' AND
          json_type(${result}, '$.ad') = 'object' AND (SELECT count(*) FROM json_each(${result}, '$.ad')) = 2 AND
          json_type(${result}, '$.ad.object_id') = 'text' AND length(trim(json_extract(${result}, '$.ad.object_id'))) BETWEEN 1 AND 255 AND
          EXISTS (SELECT 1 FROM operation_executions e JOIN operation_steps s ON s.execution_id = e.id
            WHERE e.operation_id = ${row}.id AND s.step_key = 'ad' AND s.kind = 'ad' AND s.status = 'succeeded'
              AND s.external_id = json_extract(${result}, '$.ad.object_id')) AND
          json_type(${result}, '$.ad.delivery_status') = 'text' AND json_extract(${result}, '$.ad.delivery_status') = 'PAUSED') OR
        (${row}.operation_type IN ('update_object','change_delivery','configure_monthly_budget') AND
          (SELECT count(*) FROM json_each(${result})) = 3)
      ) THEN 1 ELSE 0 END
    WHEN ${row}.status = 'failed' THEN CASE WHEN
      (SELECT count(*) FROM json_each(${result})) = 6 AND
      json_type(${result}, '$.status') = 'text' AND json_extract(${result}, '$.status') = 'failed' AND
      json_type(${result}, '$.completed_at') = 'text' AND datetime(json_extract(${result}, '$.completed_at')) IS NOT NULL AND
      json_type(${result}, '$.failure_code') = 'text' AND json_extract(${result}, '$.failure_code') IN (
        'operation_stale','meta_configuration_required','meta_reauthorization_required','meta_asset_access_required',
        'meta_permission_missing','media_invalid','rate_limited','meta_error') AND
      json_type(${result}, '$.proven_resources') = 'array' AND NOT EXISTS (
        SELECT 1 FROM json_each(${result}, '$.proven_resources') resource WHERE CASE WHEN
          json_type(resource.value) = 'object' AND (SELECT count(*) FROM json_each(resource.value)) = 2 AND
          json_type(resource.value, '$.type') = 'text' AND json_extract(resource.value, '$.type') IN ('image','video','campaign','ad_set','creative','ad','object','budget') AND
          json_type(resource.value, '$.id') = 'text' AND length(trim(json_extract(resource.value, '$.id'))) BETWEEN 1 AND 255
          THEN 0 ELSE 1 END = 1
      ) AND
      json_array_length(${result}, '$.proven_resources') = (
        SELECT count(*) FROM operation_executions e JOIN operation_steps s ON s.execution_id = e.id
        WHERE e.operation_id = ${row}.id AND s.status = 'succeeded'
      ) AND NOT EXISTS (
        SELECT 1 FROM json_each(${result}, '$.proven_resources') resource WHERE NOT EXISTS (
          SELECT 1 FROM operation_executions e JOIN operation_steps s ON s.execution_id = e.id
          WHERE e.operation_id = ${row}.id AND s.status = 'succeeded'
            AND CASE s.kind WHEN 'update_object' THEN 'object' WHEN 'change_delivery' THEN 'object'
              WHEN 'configure_monthly_budget' THEN 'budget' ELSE s.kind END = json_extract(resource.value, '$.type')
            AND s.external_id = json_extract(resource.value, '$.id')
            AND (SELECT count(*) FROM operation_steps prior
              WHERE prior.execution_id = s.execution_id AND prior.status = 'succeeded' AND prior.sequence < s.sequence) = CAST(resource.key AS INTEGER)
        )
      ) AND
      json_type(${result}, '$.failed_or_ambiguous_step') IN ('text','null') AND
      (json_type(${result}, '$.failed_or_ambiguous_step') = 'null' OR length(trim(json_extract(${result}, '$.failed_or_ambiguous_step'))) BETWEEN 1 AND 255) AND
      json_type(${result}, '$.next_action') = 'text' AND json_extract(${result}, '$.next_action') = 'fix_input'
      THEN 1 ELSE 0 END
    ELSE 0 END ELSE 0 END`;
}

const unitFiveRemediation = `
  DROP TRIGGER operation_steps_intent_insert;
  DROP TRIGGER operation_steps_immutable;
  DROP TRIGGER operation_steps_transition;
  DROP TRIGGER operation_steps_no_delete;
  DROP TRIGGER operation_execution_audit_links_no_update;
  DROP TRIGGER operation_execution_audit_links_no_delete;
  ALTER TABLE operation_execution_audit_links RENAME TO operation_execution_audit_links_v5;
  ALTER TABLE operation_steps RENAME TO operation_steps_v5;

  CREATE TABLE operation_steps (
    execution_id TEXT NOT NULL,
    operation_id TEXT NOT NULL,
    step_key TEXT NOT NULL CHECK (length(trim(step_key)) > 0),
    sequence INTEGER NOT NULL CHECK (sequence >= 0),
    kind TEXT NOT NULL CHECK (kind IN ('image', 'video', 'campaign', 'ad_set', 'creative', 'ad', 'update_object', 'change_delivery', 'configure_monthly_budget')),
    status TEXT NOT NULL CHECK (status IN ('intent', 'succeeded', 'failed', 'reconciliation_required')),
    request_hash TEXT NOT NULL CHECK (length(request_hash) = 64 AND request_hash NOT GLOB '*[^a-f0-9]*'),
    correlation_id TEXT NOT NULL CHECK (length(trim(correlation_id)) > 0),
    external_id TEXT CHECK (external_id IS NULL OR length(trim(external_id)) > 0),
    error_code TEXT CHECK (error_code IS NULL OR length(trim(error_code)) > 0),
    attempted_at TEXT NOT NULL CHECK (datetime(attempted_at) IS NOT NULL),
    completed_at TEXT CHECK (completed_at IS NULL OR datetime(completed_at) IS NOT NULL),
    PRIMARY KEY (execution_id, step_key),
    UNIQUE (execution_id, sequence),
    FOREIGN KEY (execution_id, operation_id) REFERENCES operation_executions(id, operation_id),
    CHECK (
      (status = 'intent' AND external_id IS NULL AND error_code IS NULL AND completed_at IS NULL) OR
      (status = 'succeeded' AND external_id IS NOT NULL AND error_code IS NULL AND completed_at IS NOT NULL) OR
      (status IN ('failed', 'reconciliation_required') AND external_id IS NULL AND error_code IS NOT NULL AND completed_at IS NOT NULL)
    )
  ) STRICT;
  INSERT INTO operation_steps SELECT s.execution_id, s.operation_id, s.step_key, s.sequence, s.kind, s.status,
    s.request_hash, s.correlation_id, s.external_id, s.error_code, s.attempted_at, s.completed_at
    FROM operation_steps_v5 s;

  CREATE TABLE operation_execution_audit_links (
    audit_id TEXT PRIMARY KEY REFERENCES audit_log(id),
    operation_id TEXT NOT NULL,
    decision_id TEXT NOT NULL,
    execution_id TEXT NOT NULL,
    step_key TEXT CHECK (step_key IS NULL OR length(trim(step_key)) > 0),
    event_type TEXT NOT NULL CHECK (event_type IN ('meta_call', 'execution')),
    FOREIGN KEY (decision_id, operation_id) REFERENCES approval_decisions(id, operation_id),
    FOREIGN KEY (execution_id, operation_id) REFERENCES operation_executions(id, operation_id),
    FOREIGN KEY (execution_id, step_key) REFERENCES operation_steps(execution_id, step_key),
    CHECK (event_type <> 'meta_call' OR step_key IS NOT NULL)
  ) STRICT;
  INSERT INTO operation_execution_audit_links SELECT * FROM operation_execution_audit_links_v5;
  DROP TABLE operation_execution_audit_links_v5;
  DROP TABLE operation_steps_v5;

  CREATE TRIGGER operation_steps_intent_insert BEFORE INSERT ON operation_steps WHEN NEW.status <> 'intent'
  BEGIN SELECT RAISE(ABORT, 'operation step requires a persisted write intent'); END;
  CREATE TRIGGER operation_steps_shape_insert BEFORE INSERT ON operation_steps WHEN NOT EXISTS (
    SELECT 1 FROM operation_executions e JOIN operations o ON o.id = e.operation_id
    WHERE e.id = NEW.execution_id AND o.id = NEW.operation_id AND (
      (o.operation_type = 'create_campaign_bundle' AND (
        (NEW.sequence = 0 AND EXISTS (SELECT 1 FROM operation_media om JOIN staged_media m ON m.id = om.media_id
          WHERE om.operation_id = o.id AND NEW.step_key = 'media:' || om.media_id AND NEW.kind = m.media_type AND m.status = 'bound')) OR
        (NEW.sequence = 1 AND NEW.step_key = 'campaign' AND NEW.kind = 'campaign' AND EXISTS (SELECT 1 FROM operation_steps p WHERE p.execution_id = NEW.execution_id AND p.sequence = 0 AND p.status = 'succeeded')) OR
        (NEW.sequence = 2 AND NEW.step_key = 'ad_set' AND NEW.kind = 'ad_set' AND EXISTS (SELECT 1 FROM operation_steps p WHERE p.execution_id = NEW.execution_id AND p.sequence = 1 AND p.status = 'succeeded')) OR
        (NEW.sequence = 3 AND NEW.step_key = 'creative' AND NEW.kind = 'creative' AND EXISTS (SELECT 1 FROM operation_steps p WHERE p.execution_id = NEW.execution_id AND p.sequence = 2 AND p.status = 'succeeded')) OR
        (NEW.sequence = 4 AND NEW.step_key = 'ad' AND NEW.kind = 'ad' AND EXISTS (SELECT 1 FROM operation_steps p WHERE p.execution_id = NEW.execution_id AND p.sequence = 3 AND p.status = 'succeeded'))
      )) OR
      (o.operation_type = 'update_object' AND NEW.sequence = 0 AND NEW.step_key = 'update_object' AND NEW.kind = 'update_object') OR
      (o.operation_type = 'change_delivery' AND NEW.sequence = 0 AND NEW.step_key = 'change_delivery' AND NEW.kind = 'change_delivery') OR
      (o.operation_type = 'configure_monthly_budget' AND NEW.sequence = 0 AND NEW.step_key = 'configure_monthly_budget' AND NEW.kind = 'configure_monthly_budget')
    )
  ) BEGIN SELECT RAISE(ABORT, 'operation step does not match operation type and order'); END;
  CREATE TRIGGER operation_steps_immutable BEFORE UPDATE OF execution_id, operation_id, step_key, sequence, kind, request_hash, correlation_id, attempted_at ON operation_steps
  BEGIN SELECT RAISE(ABORT, 'operation step identity is immutable'); END;
  CREATE TRIGGER operation_steps_transition BEFORE UPDATE OF status, external_id, error_code, completed_at ON operation_steps
    WHEN OLD.status <> 'intent' OR NEW.status NOT IN ('succeeded', 'failed', 'reconciliation_required') OR
      (NEW.sequence > 0 AND NOT EXISTS (SELECT 1 FROM operation_steps p WHERE p.execution_id = NEW.execution_id AND p.sequence = NEW.sequence - 1 AND p.status = 'succeeded'))
  BEGIN SELECT RAISE(ABORT, 'invalid operation step transition'); END;
  CREATE TRIGGER operation_steps_no_delete BEFORE DELETE ON operation_steps
  BEGIN SELECT RAISE(ABORT, 'operation step history is immutable'); END;
  CREATE TRIGGER operation_execution_audit_links_no_update BEFORE UPDATE ON operation_execution_audit_links
  BEGIN SELECT RAISE(ABORT, 'operation execution audit link is immutable'); END;
  CREATE TRIGGER operation_execution_audit_links_no_delete BEFORE DELETE ON operation_execution_audit_links
  BEGIN SELECT RAISE(ABORT, 'operation execution audit link is immutable'); END;

  CREATE TRIGGER operation_execution_claim_audit AFTER INSERT ON operation_executions BEGIN
    INSERT INTO audit_log (id, actor, client_id, ad_account_id, generation_id, logical_operation, correlation_id, occurred_at, outcome, evidence)
      SELECT 'execution-' || NEW.id || '-claim', d.owner_identity, o.client_id, o.ad_account_id, o.generation_id,
        'execution_claim', NEW.correlation_id, NEW.claimed_at, 'started', json_object('externalRequestId', NEW.id)
      FROM operations o JOIN approval_decisions d ON d.id = NEW.decision_id WHERE o.id = NEW.operation_id;
    INSERT INTO operation_execution_audit_links (audit_id, operation_id, decision_id, execution_id, event_type)
      VALUES ('execution-' || NEW.id || '-claim', NEW.operation_id, NEW.decision_id, NEW.id, 'execution');
  END;
  CREATE TRIGGER operation_step_intent_audit AFTER INSERT ON operation_steps BEGIN
    INSERT INTO audit_log (id, actor, client_id, ad_account_id, generation_id, logical_operation, correlation_id, occurred_at, outcome, evidence)
      SELECT 'execution-' || NEW.execution_id || '-step-' || NEW.sequence || '-intent', d.owner_identity, o.client_id, o.ad_account_id, o.generation_id,
        'execution_step_intent', NEW.correlation_id, NEW.attempted_at, 'started', json_object('externalRequestId', NEW.step_key)
      FROM operation_executions e JOIN operations o ON o.id = e.operation_id JOIN approval_decisions d ON d.id = e.decision_id WHERE e.id = NEW.execution_id;
    INSERT INTO operation_execution_audit_links (audit_id, operation_id, decision_id, execution_id, step_key, event_type)
      SELECT 'execution-' || NEW.execution_id || '-step-' || NEW.sequence || '-intent', NEW.operation_id, e.decision_id, NEW.execution_id, NEW.step_key, 'execution'
      FROM operation_executions e WHERE e.id = NEW.execution_id;
  END;
  CREATE TRIGGER operation_step_outcome_audit AFTER UPDATE OF status ON operation_steps WHEN OLD.status = 'intent' BEGIN
    INSERT INTO audit_log (id, actor, client_id, ad_account_id, generation_id, logical_operation, correlation_id, occurred_at, outcome, evidence)
      SELECT 'execution-' || NEW.execution_id || '-step-' || NEW.sequence || '-outcome', d.owner_identity, o.client_id, o.ad_account_id, o.generation_id,
        'execution_step_outcome', NEW.correlation_id, NEW.completed_at, CASE WHEN NEW.status = 'succeeded' THEN 'succeeded' ELSE 'failed' END,
        CASE WHEN NEW.status = 'succeeded' THEN json_object('externalRequestId', NEW.external_id) ELSE json_object('errorCode', NEW.error_code) END
      FROM operation_executions e JOIN operations o ON o.id = e.operation_id JOIN approval_decisions d ON d.id = e.decision_id WHERE e.id = NEW.execution_id;
    INSERT INTO operation_execution_audit_links (audit_id, operation_id, decision_id, execution_id, step_key, event_type)
      SELECT 'execution-' || NEW.execution_id || '-step-' || NEW.sequence || '-outcome', NEW.operation_id, e.decision_id, NEW.execution_id, NEW.step_key, 'execution'
      FROM operation_executions e WHERE e.id = NEW.execution_id;
  END;

  CREATE TRIGGER operation_terminal_result_immutable BEFORE UPDATE OF status, result_json ON operations
    WHEN OLD.status IN ('succeeded', 'failed')
  BEGIN SELECT RAISE(ABORT, 'immutable terminal result'); END;
  CREATE TRIGGER operation_terminal_validate BEFORE UPDATE OF status, result_json ON operations
    WHEN OLD.status = 'executing' AND NEW.status IN ('succeeded', 'failed') AND ${terminalResultIsValid("NEW")} <> 1
  BEGIN SELECT RAISE(ABORT, 'typed execution result is required'); END;
  CREATE TRIGGER operation_terminal_requires_execution BEFORE UPDATE OF status ON operations
    WHEN OLD.status = 'executing' AND NEW.status IN ('succeeded', 'failed') AND
      (SELECT count(*) FROM operation_executions e WHERE e.operation_id = NEW.id AND e.status = 'running') <> 1
  BEGIN SELECT RAISE(ABORT, 'terminal operation requires exactly one running execution'); END;
  CREATE TRIGGER operation_success_complete BEFORE UPDATE OF status ON operations
    WHEN OLD.status = 'executing' AND NEW.status = 'succeeded' AND NOT EXISTS (
      SELECT 1 FROM operation_executions e WHERE e.operation_id = NEW.id AND e.status = 'running' AND (
        (NEW.operation_type = 'create_campaign_bundle' AND
          (SELECT count(*) FROM operation_steps s WHERE s.execution_id = e.id AND s.status = 'succeeded') = 5 AND
          EXISTS (SELECT 1 FROM operation_steps s JOIN operation_media om ON om.operation_id = NEW.id AND s.step_key = 'media:' || om.media_id
            JOIN staged_media m ON m.id = om.media_id AND m.media_type = s.kind
            WHERE s.execution_id = e.id AND s.sequence = 0 AND s.status = 'succeeded') AND
          EXISTS (SELECT 1 FROM operation_steps s WHERE s.execution_id = e.id AND s.sequence = 1 AND s.step_key = 'campaign' AND s.kind = 'campaign' AND s.status = 'succeeded') AND
          EXISTS (SELECT 1 FROM operation_steps s WHERE s.execution_id = e.id AND s.sequence = 2 AND s.step_key = 'ad_set' AND s.kind = 'ad_set' AND s.status = 'succeeded') AND
          EXISTS (SELECT 1 FROM operation_steps s WHERE s.execution_id = e.id AND s.sequence = 3 AND s.step_key = 'creative' AND s.kind = 'creative' AND s.status = 'succeeded') AND
          EXISTS (SELECT 1 FROM operation_steps s WHERE s.execution_id = e.id AND s.sequence = 4 AND s.step_key = 'ad' AND s.kind = 'ad' AND s.status = 'succeeded')) OR
        (NEW.operation_type <> 'create_campaign_bundle' AND (SELECT count(*) FROM operation_steps s WHERE s.execution_id = e.id AND s.status = 'succeeded') = 1)
      )
    )
  BEGIN SELECT RAISE(ABORT, 'complete bundle resource evidence is required'); END;
  CREATE TRIGGER execution_terminal_requires_operation BEFORE UPDATE OF status ON operation_executions
    WHEN OLD.status = 'running' AND NEW.status IN ('succeeded', 'failed') AND NOT EXISTS (
      SELECT 1 FROM operations o WHERE o.id = NEW.operation_id AND
        ((NEW.status = 'succeeded' AND o.status = 'succeeded') OR (NEW.status = 'failed' AND o.status IN ('failed', 'stale')))
    )
  BEGIN SELECT RAISE(ABORT, 'execution terminal coupling requires operation result'); END;
  CREATE TRIGGER operation_terminal_coupling AFTER UPDATE OF status ON operations
    WHEN OLD.status = 'executing' AND NEW.status IN ('succeeded', 'failed', 'stale')
  BEGIN
    UPDATE operation_executions SET status = CASE WHEN NEW.status = 'succeeded' THEN 'succeeded' ELSE 'failed' END,
      completed_at = COALESCE(json_extract(NEW.result_json, '$.completed_at'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      WHERE operation_id = NEW.id AND status = 'running';
  END;
  CREATE TRIGGER execution_status_audit AFTER UPDATE OF status ON operation_executions WHEN OLD.status <> NEW.status BEGIN
    INSERT INTO audit_log (id, actor, client_id, ad_account_id, generation_id, logical_operation, correlation_id, occurred_at, outcome, evidence)
      SELECT 'execution-' || NEW.id || '-status-' || NEW.status, d.owner_identity, o.client_id, o.ad_account_id, o.generation_id,
        CASE WHEN NEW.status = 'reconciliation_required' THEN 'execution_reconciliation_required' ELSE 'execution_result' END,
        NEW.correlation_id, COALESCE(NEW.completed_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        CASE WHEN NEW.status = 'succeeded' THEN 'succeeded' ELSE 'failed' END,
        CASE WHEN NEW.status = 'reconciliation_required' THEN json_object('errorCode', 'ambiguous_write') ELSE json_object('externalRequestId', NEW.id) END
      FROM operations o JOIN approval_decisions d ON d.id = NEW.decision_id WHERE o.id = NEW.operation_id;
    INSERT INTO operation_execution_audit_links (audit_id, operation_id, decision_id, execution_id, event_type)
      VALUES ('execution-' || NEW.id || '-status-' || NEW.status, NEW.operation_id, NEW.decision_id, NEW.id, 'execution');
  END;
`;

function assertUnitFourRowsValid(db: DatabaseSync): void {
  const invalid = db.prepare(`
    SELECT EXISTS (
      SELECT 1 FROM staged_media m JOIN integration_generations g ON g.id = m.generation_id
      WHERE CAST(g.generation AS INTEGER) <= 0
         OR m.expires_at <> strftime('%Y-%m-%dT%H:%M:%fZ', m.created_at, '+12 hours')
      UNION ALL
      SELECT 1 FROM operations o JOIN integration_generations g ON g.id = o.generation_id
      WHERE CAST(g.generation AS INTEGER) <= 0
         OR o.expires_at <> strftime('%Y-%m-%dT%H:%M:%fZ', o.created_at, '+12 hours')
         OR NOT (
           (o.status IN ('pending', 'executing', 'rejected', 'expired', 'stale') AND o.result_json IS NULL) OR
           (o.status IN ('succeeded', 'failed') AND o.result_json IS NOT NULL AND json_valid(o.result_json) AND json_type(o.result_json) = 'object')
         )
      UNION ALL
      SELECT 1 FROM operation_idempotency i LEFT JOIN operations o
        ON o.id = i.operation_id AND o.payload_hash = i.payload_hash AND o.actor = i.actor
       AND o.operation_type = i.operation_type AND o.client_id = i.client_id AND o.ad_account_id = i.ad_account_id
      WHERE o.id IS NULL
    ) AS invalid
  `).get()!.invalid;
  if (invalid === 1) throw new Error("Existing Unit 4 invariant violation");
}

function assertUnitFiveRowsValid(db: DatabaseSync): void {
  const invalid = db.prepare(`
    SELECT EXISTS (
      SELECT 1 FROM operation_steps s
      JOIN operation_executions e ON e.id = s.execution_id
      JOIN operations o ON o.id = e.operation_id
      WHERE NOT (
        (o.operation_type = 'create_campaign_bundle' AND (
          (s.sequence = 0 AND EXISTS (SELECT 1 FROM operation_media om JOIN staged_media m ON m.id = om.media_id
            WHERE om.operation_id = o.id AND s.step_key = 'media:' || om.media_id AND s.kind = m.media_type)) OR
          (s.sequence = 1 AND s.step_key = 'campaign' AND s.kind = 'campaign' AND EXISTS (SELECT 1 FROM operation_steps p WHERE p.execution_id = s.execution_id AND p.sequence = 0 AND p.status = 'succeeded')) OR
          (s.sequence = 2 AND s.step_key = 'ad_set' AND s.kind = 'ad_set' AND EXISTS (SELECT 1 FROM operation_steps p WHERE p.execution_id = s.execution_id AND p.sequence = 1 AND p.status = 'succeeded')) OR
          (s.sequence = 3 AND s.step_key = 'creative' AND s.kind = 'creative' AND EXISTS (SELECT 1 FROM operation_steps p WHERE p.execution_id = s.execution_id AND p.sequence = 2 AND p.status = 'succeeded')) OR
          (s.sequence = 4 AND s.step_key = 'ad' AND s.kind = 'ad' AND EXISTS (SELECT 1 FROM operation_steps p WHERE p.execution_id = s.execution_id AND p.sequence = 3 AND p.status = 'succeeded'))
        )) OR
        (o.operation_type = 'update_object' AND s.sequence = 0 AND s.step_key = 'update_object' AND s.kind = 'update_object') OR
        (o.operation_type = 'change_delivery' AND s.sequence = 0 AND s.step_key = 'change_delivery' AND s.kind = 'change_delivery') OR
        (o.operation_type = 'configure_monthly_budget' AND s.sequence = 0 AND s.step_key = 'configure_monthly_budget' AND s.kind = 'configure_monthly_budget')
      )
      UNION ALL
      SELECT 1 FROM operation_executions e JOIN operations o ON o.id = e.operation_id
      WHERE (e.status = 'succeeded' AND (o.status <> 'succeeded' OR
        (o.operation_type = 'create_campaign_bundle' AND (SELECT count(*) FROM operation_steps s WHERE s.execution_id = e.id AND s.status = 'succeeded') <> 5) OR
        (o.operation_type <> 'create_campaign_bundle' AND (SELECT count(*) FROM operation_steps s WHERE s.execution_id = e.id AND s.status = 'succeeded') <> 1)))
        OR (e.status = 'failed' AND o.status NOT IN ('failed','stale'))
        OR (e.status IN ('running','reconciliation_required') AND o.status <> 'executing')
      UNION ALL
       SELECT 1 FROM operations o LEFT JOIN operation_executions e ON e.operation_id = o.id
       WHERE o.status IN ('succeeded','failed')
       GROUP BY o.id
       HAVING count(e.id) <> 1 OR
         max(CASE WHEN (o.status = 'succeeded' AND e.status = 'succeeded') OR (o.status = 'failed' AND e.status = 'failed') THEN 1 ELSE 0 END) <> 1 OR
         ${terminalResultIsValid("o")} <> 1
    ) AS invalid
  `).get()!.invalid;
  if (invalid === 1) throw new Error("Existing Unit 5 invariant violation");
}

function assertUnitFiveAuditEvidence(db: DatabaseSync): void {
  const invalid = db.prepare(`SELECT EXISTS (
    SELECT 1 FROM operation_execution_audit_links l WHERE
      (l.event_type = 'meta_call' AND l.step_key IS NULL) OR
      (l.step_key IS NOT NULL AND (length(trim(l.step_key)) = 0 OR NOT EXISTS (
        SELECT 1 FROM operation_steps linked
        WHERE linked.execution_id = l.execution_id AND linked.operation_id = l.operation_id AND linked.step_key = l.step_key
      )))
    UNION ALL
    SELECT 1 FROM operation_steps s JOIN operation_executions e ON e.id = s.execution_id
    WHERE NOT EXISTS (
      SELECT 1 FROM operation_execution_audit_links l JOIN audit_log a ON a.id = l.audit_id
      WHERE l.execution_id = s.execution_id AND l.step_key = s.step_key AND a.outcome = 'started' AND a.correlation_id = s.correlation_id
    ) OR (s.status <> 'intent' AND NOT EXISTS (
      SELECT 1 FROM operation_execution_audit_links outcome_link JOIN audit_log outcome ON outcome.id = outcome_link.audit_id
      JOIN operation_execution_audit_links intent_link ON intent_link.execution_id = s.execution_id AND intent_link.step_key = s.step_key
      JOIN audit_log intent ON intent.id = intent_link.audit_id
      WHERE outcome_link.execution_id = s.execution_id AND outcome_link.step_key = s.step_key
        AND outcome.outcome = CASE WHEN s.status = 'succeeded' THEN 'succeeded' ELSE 'failed' END
        AND outcome.correlation_id = s.correlation_id AND intent.outcome = 'started' AND intent.correlation_id = s.correlation_id
        AND outcome.rowid > intent.rowid
    )) OR (s.sequence > 0 AND NOT EXISTS (
      SELECT 1 FROM operation_steps predecessor
      JOIN operation_execution_audit_links predecessor_link ON predecessor_link.execution_id = predecessor.execution_id AND predecessor_link.step_key = predecessor.step_key
      JOIN audit_log predecessor_outcome ON predecessor_outcome.id = predecessor_link.audit_id AND predecessor_outcome.outcome = 'succeeded'
      JOIN operation_execution_audit_links current_link ON current_link.execution_id = s.execution_id AND current_link.step_key = s.step_key
      JOIN audit_log current_intent ON current_intent.id = current_link.audit_id AND current_intent.outcome = 'started'
      WHERE predecessor.execution_id = s.execution_id AND predecessor.sequence = s.sequence - 1
        AND predecessor_outcome.correlation_id = predecessor.correlation_id AND current_intent.correlation_id = s.correlation_id
        AND predecessor_outcome.rowid < current_intent.rowid
    ))
  ) AS invalid`).get()!.invalid;
  if (invalid === 1) throw new Error("Existing Unit 5 step lacks immutable linked audit evidence");
}

const unitFiveSqliteHardening = `
  DROP TRIGGER operation_steps_shape_insert;
  DROP TRIGGER operation_steps_transition;
  DROP TRIGGER operation_terminal_validate;
  DROP TRIGGER IF EXISTS operation_terminal_requires_execution;
  CREATE TRIGGER operation_steps_shape_insert BEFORE INSERT ON operation_steps WHEN NOT EXISTS (
    SELECT 1 FROM operation_executions e JOIN operations o ON o.id = e.operation_id
    WHERE e.id = NEW.execution_id AND o.id = NEW.operation_id AND (
      (o.operation_type = 'create_campaign_bundle' AND (
        (NEW.sequence = 0 AND EXISTS (SELECT 1 FROM operation_media om JOIN staged_media m ON m.id = om.media_id
          WHERE om.operation_id = o.id AND NEW.step_key = 'media:' || om.media_id AND NEW.kind = m.media_type AND m.status = 'bound')) OR
        (NEW.sequence = 1 AND NEW.step_key = 'campaign' AND NEW.kind = 'campaign' AND EXISTS (SELECT 1 FROM operation_steps p WHERE p.execution_id = NEW.execution_id AND p.sequence = 0 AND p.status = 'succeeded')) OR
        (NEW.sequence = 2 AND NEW.step_key = 'ad_set' AND NEW.kind = 'ad_set' AND EXISTS (SELECT 1 FROM operation_steps p WHERE p.execution_id = NEW.execution_id AND p.sequence = 1 AND p.status = 'succeeded')) OR
        (NEW.sequence = 3 AND NEW.step_key = 'creative' AND NEW.kind = 'creative' AND EXISTS (SELECT 1 FROM operation_steps p WHERE p.execution_id = NEW.execution_id AND p.sequence = 2 AND p.status = 'succeeded')) OR
        (NEW.sequence = 4 AND NEW.step_key = 'ad' AND NEW.kind = 'ad' AND EXISTS (SELECT 1 FROM operation_steps p WHERE p.execution_id = NEW.execution_id AND p.sequence = 3 AND p.status = 'succeeded'))
      )) OR
      (o.operation_type = 'update_object' AND NEW.sequence = 0 AND NEW.step_key = 'update_object' AND NEW.kind = 'update_object') OR
      (o.operation_type = 'change_delivery' AND NEW.sequence = 0 AND NEW.step_key = 'change_delivery' AND NEW.kind = 'change_delivery') OR
      (o.operation_type = 'configure_monthly_budget' AND NEW.sequence = 0 AND NEW.step_key = 'configure_monthly_budget' AND NEW.kind = 'configure_monthly_budget')
    )
  ) BEGIN SELECT RAISE(ABORT, 'operation step predecessor, type, and order are invalid'); END;
  CREATE TRIGGER operation_steps_transition BEFORE UPDATE OF status, external_id, error_code, completed_at ON operation_steps
    WHEN OLD.status <> 'intent' OR NEW.status NOT IN ('succeeded', 'failed', 'reconciliation_required') OR
      (NEW.sequence > 0 AND NOT EXISTS (SELECT 1 FROM operation_steps p WHERE p.execution_id = NEW.execution_id AND p.sequence = NEW.sequence - 1 AND p.status = 'succeeded'))
  BEGIN SELECT RAISE(ABORT, 'invalid operation step transition or predecessor'); END;
  CREATE TRIGGER operation_terminal_validate BEFORE UPDATE OF status, result_json ON operations
    WHEN OLD.status = 'executing' AND NEW.status IN ('succeeded', 'failed') AND ${terminalResultIsValid("NEW")} <> 1
  BEGIN SELECT RAISE(ABORT, 'typed execution result is required'); END;
  CREATE TRIGGER operation_terminal_requires_execution BEFORE UPDATE OF status ON operations
    WHEN OLD.status = 'executing' AND NEW.status IN ('succeeded', 'failed') AND
      (SELECT count(*) FROM operation_executions e WHERE e.operation_id = NEW.id AND e.status = 'running') <> 1
  BEGIN SELECT RAISE(ABORT, 'terminal operation requires exactly one running execution'); END;
`;

const unitFiveV8 = `
  DROP TRIGGER operation_execution_claim_audit;
  DROP TRIGGER operation_step_intent_audit;
  DROP TRIGGER operation_step_outcome_audit;
  DROP TRIGGER execution_status_audit;
  CREATE TABLE operation_execution_audit_links_v8 (
    audit_id TEXT PRIMARY KEY REFERENCES audit_log(id),
    operation_id TEXT NOT NULL,
    decision_id TEXT NOT NULL,
    execution_id TEXT NOT NULL,
    step_key TEXT CHECK (step_key IS NULL OR length(trim(step_key)) > 0),
    event_type TEXT NOT NULL CHECK (event_type IN ('meta_call', 'execution')),
    FOREIGN KEY (decision_id, operation_id) REFERENCES approval_decisions(id, operation_id),
    FOREIGN KEY (execution_id, operation_id) REFERENCES operation_executions(id, operation_id),
    FOREIGN KEY (execution_id, step_key) REFERENCES operation_steps(execution_id, step_key),
    CHECK (event_type <> 'meta_call' OR step_key IS NOT NULL)
  ) STRICT;
  INSERT INTO operation_execution_audit_links_v8 SELECT * FROM operation_execution_audit_links;
  DROP TRIGGER operation_execution_audit_links_no_update;
  DROP TRIGGER operation_execution_audit_links_no_delete;
  DROP TABLE operation_execution_audit_links;
  ALTER TABLE operation_execution_audit_links_v8 RENAME TO operation_execution_audit_links;
  CREATE TRIGGER operation_execution_audit_links_no_update BEFORE UPDATE ON operation_execution_audit_links
  BEGIN SELECT RAISE(ABORT, 'operation execution audit link is immutable'); END;
  CREATE TRIGGER operation_execution_audit_links_no_delete BEFORE DELETE ON operation_execution_audit_links
  BEGIN SELECT RAISE(ABORT, 'operation execution audit link is immutable'); END;
  CREATE TRIGGER operation_execution_claim_audit AFTER INSERT ON operation_executions BEGIN
    INSERT INTO audit_log (id, actor, client_id, ad_account_id, generation_id, logical_operation, correlation_id, occurred_at, outcome, evidence)
      SELECT 'execution-' || NEW.id || '-claim', d.owner_identity, o.client_id, o.ad_account_id, o.generation_id,
        'execution_claim', NEW.correlation_id, NEW.claimed_at, 'started', json_object('externalRequestId', NEW.id)
      FROM operations o JOIN approval_decisions d ON d.id = NEW.decision_id WHERE o.id = NEW.operation_id;
    INSERT INTO operation_execution_audit_links (audit_id, operation_id, decision_id, execution_id, event_type)
      VALUES ('execution-' || NEW.id || '-claim', NEW.operation_id, NEW.decision_id, NEW.id, 'execution');
  END;
  CREATE TRIGGER operation_step_intent_audit AFTER INSERT ON operation_steps BEGIN
    INSERT INTO audit_log (id, actor, client_id, ad_account_id, generation_id, logical_operation, correlation_id, occurred_at, outcome, evidence)
      SELECT 'execution-' || NEW.execution_id || '-step-' || NEW.sequence || '-intent', d.owner_identity, o.client_id, o.ad_account_id, o.generation_id,
        'execution_step_intent', NEW.correlation_id, NEW.attempted_at, 'started', json_object('externalRequestId', NEW.step_key)
      FROM operation_executions e JOIN operations o ON o.id = e.operation_id JOIN approval_decisions d ON d.id = e.decision_id WHERE e.id = NEW.execution_id;
    INSERT INTO operation_execution_audit_links (audit_id, operation_id, decision_id, execution_id, step_key, event_type)
      SELECT 'execution-' || NEW.execution_id || '-step-' || NEW.sequence || '-intent', NEW.operation_id, e.decision_id, NEW.execution_id, NEW.step_key, 'execution'
      FROM operation_executions e WHERE e.id = NEW.execution_id;
  END;
  CREATE TRIGGER operation_step_outcome_audit AFTER UPDATE OF status ON operation_steps WHEN OLD.status = 'intent' BEGIN
    INSERT INTO audit_log (id, actor, client_id, ad_account_id, generation_id, logical_operation, correlation_id, occurred_at, outcome, evidence)
      SELECT 'execution-' || NEW.execution_id || '-step-' || NEW.sequence || '-outcome', d.owner_identity, o.client_id, o.ad_account_id, o.generation_id,
        'execution_step_outcome', NEW.correlation_id, NEW.completed_at, CASE WHEN NEW.status = 'succeeded' THEN 'succeeded' ELSE 'failed' END,
        CASE WHEN NEW.status = 'succeeded' THEN json_object('externalRequestId', NEW.external_id) ELSE json_object('errorCode', NEW.error_code) END
      FROM operation_executions e JOIN operations o ON o.id = e.operation_id JOIN approval_decisions d ON d.id = e.decision_id WHERE e.id = NEW.execution_id;
    INSERT INTO operation_execution_audit_links (audit_id, operation_id, decision_id, execution_id, step_key, event_type)
      SELECT 'execution-' || NEW.execution_id || '-step-' || NEW.sequence || '-outcome', NEW.operation_id, e.decision_id, NEW.execution_id, NEW.step_key, 'execution'
      FROM operation_executions e WHERE e.id = NEW.execution_id;
  END;
  CREATE TRIGGER execution_status_audit AFTER UPDATE OF status ON operation_executions WHEN OLD.status <> NEW.status BEGIN
    INSERT INTO audit_log (id, actor, client_id, ad_account_id, generation_id, logical_operation, correlation_id, occurred_at, outcome, evidence)
      SELECT 'execution-' || NEW.id || '-status-' || NEW.status, d.owner_identity, o.client_id, o.ad_account_id, o.generation_id,
        CASE WHEN NEW.status = 'reconciliation_required' THEN 'execution_reconciliation_required' ELSE 'execution_result' END,
        NEW.correlation_id, COALESCE(NEW.completed_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        CASE WHEN NEW.status = 'succeeded' THEN 'succeeded' ELSE 'failed' END,
        CASE WHEN NEW.status = 'reconciliation_required' THEN json_object('errorCode', 'ambiguous_write') ELSE json_object('externalRequestId', NEW.id) END
      FROM operations o JOIN approval_decisions d ON d.id = NEW.decision_id WHERE o.id = NEW.operation_id;
    INSERT INTO operation_execution_audit_links (audit_id, operation_id, decision_id, execution_id, event_type)
      VALUES ('execution-' || NEW.id || '-status-' || NEW.status, NEW.operation_id, NEW.decision_id, NEW.id, 'execution');
  END;
`;

export const migrations: readonly Migration[] = [
  { version: 1, up: (db) => db.exec(initialSchema) },
  { version: 2, up: (db) => db.exec(unitFourSchema) },
  { version: 3, up: (db) => { assertUnitFourRowsValid(db); db.exec(unitFourRemediation); } },
  { version: 4, up: (db) => db.exec(approvalRetentionRemediation) },
  { version: 5, up: (db) => db.exec(unitFiveSchema) },
  { version: 6, up: (db) => { assertUnitFiveRowsValid(db); assertUnitFiveAuditEvidence(db); db.exec(unitFiveRemediation); } },
  { version: 7, up: (db) => { assertUnitFiveRowsValid(db); assertUnitFiveAuditEvidence(db); db.exec(unitFiveSqliteHardening); } },
  { version: 8, up: (db) => {
    assertUnitFiveRowsValid(db);
    assertUnitFiveAuditEvidence(db);
    db.exec(unitFiveV8);
    db.exec(unitFiveSqliteHardening);
  } },
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
