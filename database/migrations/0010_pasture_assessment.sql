-- 0010_pasture_assessment.sql
-- Land and Grazing: pasture assessments and the grazing metrics they feed.
-- Grazing occupation already exists (0008). Requirements: JK-PAS-002/004,
-- §14, §20.

CREATE TABLE pasture_assessment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  paddock_id uuid NOT NULL,
  assessed_at timestamptz NOT NULL DEFAULT now(),
  method text NOT NULL CHECK (method IN ('visual','rising_plate','sward_stick','cut_and_weigh','other')),
  condition text NOT NULL CHECK (condition IN ('poor','fair','good','excellent')),
  availability_kg_dm_ha numeric CHECK (availability_kg_dm_ha IS NULL OR availability_kg_dm_ha >= 0),
  assessed_by uuid,
  notes text,
  event_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (paddock_id, tenant_id) REFERENCES paddock(id, tenant_id)
);

CREATE INDEX pasture_assessment_paddock_idx
  ON pasture_assessment(tenant_id, paddock_id, assessed_at DESC);

ALTER TABLE pasture_assessment ENABLE ROW LEVEL SECURITY;
ALTER TABLE pasture_assessment FORCE ROW LEVEL SECURITY;

CREATE POLICY pasture_assessment_tenant_policy ON pasture_assessment
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jk_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON pasture_assessment TO jk_app';
  END IF;
END
$$;
