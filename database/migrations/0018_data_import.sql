-- 0018_data_import.sql
-- Staged import workflow (§27): upload → parse → map → validate → preview →
-- execute → reconcile → archive. Raw uploaded content is preserved verbatim as
-- import evidence (never discarded). Domain writes at the execute stage are
-- delegated to the owning module's service (module boundaries preserved); this
-- schema only stages rows and records outcomes.

CREATE TABLE import_job (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  farm_id uuid,
  import_type text NOT NULL CHECK (import_type IN ('animals')),
  status text NOT NULL DEFAULT 'uploaded'
    CHECK (status IN ('uploaded','parsed','mapped','validated','executed','reconciled','failed')),
  filename text,
  -- Raw upload preserved as evidence (§27 "archive evidence"); write-once.
  raw_content text NOT NULL,
  raw_checksum text NOT NULL,
  raw_format text NOT NULL DEFAULT 'csv' CHECK (raw_format IN ('csv')),
  mapping jsonb NOT NULL DEFAULT '{}'::jsonb,
  total_rows integer NOT NULL DEFAULT 0,
  valid_rows integer NOT NULL DEFAULT 0,
  invalid_rows integer NOT NULL DEFAULT 0,
  duplicate_rows integer NOT NULL DEFAULT 0,
  executed_rows integer NOT NULL DEFAULT 0,
  failed_rows integer NOT NULL DEFAULT 0,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  event_id text
);

CREATE INDEX import_job_status_idx ON import_job(tenant_id, status, created_at DESC);

CREATE TABLE import_row (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  import_job_id uuid NOT NULL REFERENCES import_job(id),
  row_number integer NOT NULL,
  raw jsonb NOT NULL,
  mapped jsonb,
  validation_status text NOT NULL DEFAULT 'pending'
    CHECK (validation_status IN ('pending','valid','invalid','duplicate')),
  errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  execution_status text NOT NULL DEFAULT 'pending'
    CHECK (execution_status IN ('pending','created','failed','skipped')),
  server_id text,
  execution_error text,
  UNIQUE (import_job_id, row_number)
);

CREATE INDEX import_row_job_idx ON import_row(tenant_id, import_job_id, row_number);

ALTER TABLE import_job ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_job FORCE ROW LEVEL SECURITY;
ALTER TABLE import_row ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_row FORCE ROW LEVEL SECURITY;

CREATE POLICY import_job_tenant_policy ON import_job
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY import_row_tenant_policy ON import_row
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jk_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON import_job TO jk_app';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON import_row TO jk_app';
  END IF;
END
$$;
