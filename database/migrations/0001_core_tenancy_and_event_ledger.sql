-- 0001_core_tenancy_and_event_ledger.sql
-- JK-PLT-EES-001 Appendix B baseline: core tenancy, animal identity baseline,
-- immutable domain event ledger, transactional outbox, Row-Level Security.
-- Requirements: JK-DOM-001..006, JK-CON-003, JK-SEC-004, JK-SEC-005, §37-§39.
--
-- Migrations are immutable after release. Application roles (jk_app, jk_worker)
-- are provisioned per environment by database/policies/application_roles.sql;
-- grants below are guarded so this migration also applies where those roles
-- are managed externally (production provisioning is infrastructure-owned).

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS postgis;

-- ---------------------------------------------------------------------------
-- Tenancy
-- ---------------------------------------------------------------------------

CREATE TABLE tenant (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  default_locale text NOT NULL DEFAULT 'pt-BR',
  default_currency char(3) NOT NULL DEFAULT 'BRL',
  status text NOT NULL CHECK (status IN ('active','suspended','closed')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE farm (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  name text NOT NULL,
  timezone text NOT NULL DEFAULT 'America/Sao_Paulo',
  area_ha numeric(12,4),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

-- Supporting composite keys for strict same-tenant references.
ALTER TABLE farm ADD CONSTRAINT farm_id_tenant_unique UNIQUE (id, tenant_id);

-- ---------------------------------------------------------------------------
-- Animal identity baseline (registry module arrives in Phase 1; the identity
-- schema is part of the Appendix B core baseline).
-- ---------------------------------------------------------------------------

CREATE TABLE animal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  farm_id uuid NOT NULL,
  visual_id text NOT NULL,
  species_code text NOT NULL DEFAULT 'BOVINE',
  breed_code text NOT NULL DEFAULT 'BRANGUS',
  sex text NOT NULL CHECK (sex IN ('female','male','unknown')),
  birth_date date,
  birth_date_precision text NOT NULL DEFAULT 'exact'
    CHECK (birth_date_precision IN ('exact','estimated_month','estimated_year','unknown')),
  lifecycle_status text NOT NULL DEFAULT 'active'
    CHECK (lifecycle_status IN ('planned','active','quarantined','sold','deceased','missing','transferred')),
  version integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, visual_id),
  FOREIGN KEY (farm_id, tenant_id) REFERENCES farm(id, tenant_id)
);

ALTER TABLE animal ADD CONSTRAINT animal_id_tenant_unique UNIQUE (id, tenant_id);

CREATE TABLE animal_identifier (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  animal_id uuid NOT NULL,
  identifier_type text NOT NULL CHECK (identifier_type IN ('rfid','visual','official','legacy')),
  identifier_value text NOT NULL,
  valid_from timestamptz NOT NULL,
  valid_to timestamptz,
  assigned_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_to IS NULL OR valid_to > valid_from),
  FOREIGN KEY (animal_id, tenant_id) REFERENCES animal(id, tenant_id)
);

-- JK-DOM-003: an RFID value is unique among active assignments within a tenant.
CREATE UNIQUE INDEX animal_identifier_active_unique
  ON animal_identifier(tenant_id, identifier_type, identifier_value)
  WHERE valid_to IS NULL;

CREATE INDEX animal_identifier_animal_idx
  ON animal_identifier(tenant_id, animal_id, identifier_type);

-- ---------------------------------------------------------------------------
-- Immutable domain event ledger (JK-CON-003, JK-DOM-005/006, §39)
-- ---------------------------------------------------------------------------

CREATE TABLE domain_event (
  event_id text PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  farm_id uuid,
  event_type text NOT NULL,
  schema_version integer NOT NULL CHECK (schema_version > 0),
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  aggregate_version integer NOT NULL CHECK (aggregate_version > 0),
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  actor_type text NOT NULL,
  actor_id text NOT NULL,
  source_channel text NOT NULL,
  correlation_id uuid NOT NULL,
  causation_id text,
  idempotency_key text NOT NULL,
  payload jsonb NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (tenant_id, aggregate_type, aggregate_id, aggregate_version),
  UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX domain_event_timeline_idx
  ON domain_event(tenant_id, aggregate_type, aggregate_id, occurred_at DESC, event_id DESC);

CREATE INDEX domain_event_type_idx
  ON domain_event(tenant_id, event_type, occurred_at DESC);

CREATE TABLE outbox_message (
  message_id text PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  event_id text NOT NULL UNIQUE REFERENCES domain_event(event_id),
  subject text NOT NULL,
  envelope jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  publish_attempts integer NOT NULL DEFAULT 0,
  last_error text
);

CREATE INDEX outbox_unpublished_idx ON outbox_message(created_at)
  WHERE published_at IS NULL;

-- Append-only enforcement: domain history SHALL never be updated or deleted
-- through any SQL path (JK-DOM-006). Corrections create new events.
CREATE OR REPLACE FUNCTION forbid_event_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'domain_event is append-only';
END;
$$;

CREATE TRIGGER domain_event_no_update
  BEFORE UPDATE OR DELETE ON domain_event
  FOR EACH ROW EXECUTE FUNCTION forbid_event_mutation();

-- ---------------------------------------------------------------------------
-- Row-Level Security (JK-SEC-004/005, §67). The application connects with a
-- non-superuser role and sets app.tenant_id per transaction. FORCE makes the
-- table owner subject to RLS as well (superusers always bypass; production
-- application roles are never superusers).
-- ---------------------------------------------------------------------------

ALTER TABLE tenant ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant FORCE ROW LEVEL SECURITY;
ALTER TABLE farm ENABLE ROW LEVEL SECURITY;
ALTER TABLE farm FORCE ROW LEVEL SECURITY;
ALTER TABLE animal ENABLE ROW LEVEL SECURITY;
ALTER TABLE animal FORCE ROW LEVEL SECURITY;
ALTER TABLE animal_identifier ENABLE ROW LEVEL SECURITY;
ALTER TABLE animal_identifier FORCE ROW LEVEL SECURITY;
ALTER TABLE domain_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE domain_event FORCE ROW LEVEL SECURITY;
ALTER TABLE outbox_message ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbox_message FORCE ROW LEVEL SECURITY;

-- The active tenant can see itself only.
CREATE POLICY tenant_self_policy ON tenant
  USING (id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY farm_tenant_policy ON farm
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY animal_tenant_policy ON animal
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY animal_identifier_tenant_policy ON animal_identifier
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY domain_event_tenant_policy ON domain_event
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY outbox_tenant_policy ON outbox_message
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- The outbox relay (worker) legitimately operates across tenants: it reads
-- unpublished messages and marks them published. Scoped policies to the
-- dedicated worker role are preferred over BYPASSRLS (§31.2, §67).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jk_worker') THEN
    EXECUTE 'CREATE POLICY outbox_worker_policy ON outbox_message TO jk_worker USING (true) WITH CHECK (true)';
    EXECUTE 'CREATE POLICY domain_event_worker_read ON domain_event TO jk_worker USING (true)';
    EXECUTE 'CREATE POLICY tenant_worker_read ON tenant TO jk_worker USING (true)';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Guarded grants for environment-provisioned application roles.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jk_app') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA public TO jk_app';
    EXECUTE 'GRANT SELECT, INSERT ON tenant, farm, animal, animal_identifier, domain_event, outbox_message TO jk_app';
    EXECUTE 'GRANT UPDATE ON farm, animal, animal_identifier TO jk_app';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jk_worker') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA public TO jk_worker';
    EXECUTE 'GRANT SELECT ON tenant, domain_event TO jk_worker';
    EXECUTE 'GRANT SELECT, UPDATE ON outbox_message TO jk_worker';
  END IF;
END
$$;
