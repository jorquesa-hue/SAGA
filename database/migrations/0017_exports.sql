-- 0017_exports.sql
-- Search, Import, Export, and Documents (§27) and the animal traceability
-- packet (JK-ANI-006). Exports are ASYNCHRONOUS, tenant-scoped, time-limited
-- (default 7 days, §RET), and audited. The artifact is stored with its SHA-256
-- checksum and byte size; at-rest encryption is provided by the storage layer
-- (object-store SSE / encrypted volume) in deployment.

CREATE TABLE export_job (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  requested_by text NOT NULL,
  export_type text NOT NULL
    CHECK (export_type IN ('animal_traceability_packet','animal_inventory','herd_weights','finance_ledger')),
  format text NOT NULL
    CHECK (format IN ('json','csv','xlsx','pdf','geojson','zip')),
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','completed','failed','expired')),
  -- Artifact (small exports inline; large exports reference object storage).
  result_content text,
  result_ref text,
  result_checksum text,
  byte_size integer,
  error text,
  -- Time-limited download window (§27; default 7 days).
  expires_at timestamptz NOT NULL DEFAULT now() + interval '7 days',
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  event_id text
);

CREATE INDEX export_job_status_idx ON export_job(tenant_id, status, created_at DESC);
CREATE INDEX export_job_expiry_idx ON export_job(expires_at) WHERE status = 'completed';

-- Append-only access log (every download is audited, §27/§68).
CREATE TABLE export_access_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  export_job_id uuid NOT NULL REFERENCES export_job(id),
  action text NOT NULL CHECK (action IN ('requested','completed','downloaded','denied_expired','failed')),
  actor_type text NOT NULL,
  actor_id text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX export_access_log_idx ON export_access_log(tenant_id, export_job_id, recorded_at DESC);

CREATE TRIGGER export_access_log_no_update
  BEFORE UPDATE OR DELETE ON export_access_log
  FOR EACH ROW EXECUTE FUNCTION forbid_event_mutation();

ALTER TABLE export_job ENABLE ROW LEVEL SECURITY;
ALTER TABLE export_job FORCE ROW LEVEL SECURITY;
ALTER TABLE export_access_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE export_access_log FORCE ROW LEVEL SECURITY;

CREATE POLICY export_job_tenant_policy ON export_job
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY export_access_log_tenant_policy ON export_access_log
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jk_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON export_job TO jk_app';
    EXECUTE 'GRANT SELECT, INSERT ON export_access_log TO jk_app';
  END IF;
END
$$;
