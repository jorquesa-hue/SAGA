-- Reporting (§26 mandatory reports, §47 tenant-scoped reads, §59 dashboards).
--
-- report_run is the append-only ledger of report executions. Each run stores
-- the parameters, the computed summary, and the full result snapshot, so a run
-- is reproducible and auditable: you can reopen exactly what a report said when
-- it was generated. Like the finance ledger it is insert-only (corrections are
-- new runs, never edits), enforced by the shared forbid_event_mutation trigger.

CREATE TABLE report_run (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  report_key text NOT NULL,
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  row_count integer NOT NULL CHECK (row_count >= 0),
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  result jsonb NOT NULL DEFAULT '[]'::jsonb,
  checksum text NOT NULL,
  requested_by text,
  generated_at timestamptz NOT NULL DEFAULT now(),
  event_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX report_run_key_idx
  ON report_run(tenant_id, report_key, generated_at DESC);
CREATE INDEX report_run_recent_idx
  ON report_run(tenant_id, generated_at DESC);

-- Append-only: report runs are immutable records of what a report said.
CREATE TRIGGER report_run_no_update
  BEFORE UPDATE OR DELETE ON report_run
  FOR EACH ROW EXECUTE FUNCTION forbid_event_mutation();

ALTER TABLE report_run ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_run FORCE ROW LEVEL SECURITY;

CREATE POLICY report_run_tenant_policy ON report_run
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jk_app') THEN
    EXECUTE 'GRANT SELECT, INSERT ON report_run TO jk_app';
  END IF;
END
$$;
