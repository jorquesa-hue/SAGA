-- 0004_worker_projections.sql
-- Worker consumer dedupe store + Phase 0 projection read model.
-- Requirements: JK-PLT-EES-001 §31.1-§31.2 (at-least-once delivery, consumers
-- SHALL store processed message IDs), §42 (projections expose calculated_at),
-- JK-SEC-004/005 (RLS defense in depth), §67.
--
-- Migrations are immutable after release. Grants/policies for the
-- environment-provisioned roles (jk_app, jk_worker) follow the guarded
-- DO $$ pattern from 0001 so this migration also applies where roles are
-- managed externally.

-- ---------------------------------------------------------------------------
-- Consumer dedupe (§31.2): transport is at-least-once; each consumer records
-- processed message ids so redelivery is a no-op. Insert-first with
-- ON CONFLICT DO NOTHING inside the projection transaction.
-- ---------------------------------------------------------------------------

CREATE TABLE processed_message (
  consumer_name text NOT NULL,
  message_id text NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (consumer_name, message_id)
);

-- ---------------------------------------------------------------------------
-- Phase 0 read model (§42): per-tenant, per-aggregate-type event counters.
-- Rebuildable from domain_event; exposes calculated_at as required for every
-- projection.
-- ---------------------------------------------------------------------------

CREATE TABLE projection_event_stats (
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  aggregate_type text NOT NULL,
  event_count bigint NOT NULL DEFAULT 0,
  last_event_at timestamptz,
  calculated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, aggregate_type)
);

-- ---------------------------------------------------------------------------
-- Row-Level Security (JK-SEC-004/005). FORCE subjects the owner as well.
-- processed_message carries no tenant column (message ids are ULIDs, subjects
-- are tenant-free per §49): only the dedicated worker role gets a policy, so
-- every other role is denied by default (fail closed).
-- ---------------------------------------------------------------------------

ALTER TABLE processed_message ENABLE ROW LEVEL SECURITY;
ALTER TABLE processed_message FORCE ROW LEVEL SECURITY;
ALTER TABLE projection_event_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE projection_event_stats FORCE ROW LEVEL SECURITY;

CREATE POLICY projection_event_stats_tenant_policy ON projection_event_stats
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- The projection consumer (worker) legitimately operates across tenants:
-- scoped policies to the dedicated worker role are preferred over BYPASSRLS.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jk_worker') THEN
    EXECUTE 'CREATE POLICY processed_message_worker_policy ON processed_message TO jk_worker USING (true) WITH CHECK (true)';
    EXECUTE 'CREATE POLICY projection_event_stats_worker_policy ON projection_event_stats TO jk_worker USING (true) WITH CHECK (true)';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Guarded grants for environment-provisioned application roles.
-- jk_worker: read/write both worker tables. jk_app: read-only access to the
-- projection (queries read optimized projections, §31.1), tenant-scoped by RLS.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jk_worker') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON processed_message, projection_event_stats TO jk_worker';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jk_app') THEN
    EXECUTE 'GRANT SELECT ON projection_event_stats TO jk_app';
  END IF;
END
$$;
