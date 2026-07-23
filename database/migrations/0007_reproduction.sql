-- 0007_reproduction.sql
-- Reproduction and Genetics: services (AI/TAI/natural), pregnancy checks,
-- calving with calf linkage, and parentage. Requirements: JK-REP-001..008,
-- JK-GEN-001, §12, §21.

-- reproduction_service — an insemination or natural service on a female
-- (JK-REP-003): bull/semen, technician, method.
CREATE TABLE reproduction_service (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  dam_id uuid NOT NULL,
  method text NOT NULL CHECK (method IN ('ai','tai','natural')),
  service_date timestamptz NOT NULL,
  bull_id uuid,
  external_sire_ref text,
  semen_batch text,
  technician_id uuid,
  notes text,
  event_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (dam_id, tenant_id) REFERENCES animal(id, tenant_id)
);

CREATE INDEX reproduction_service_dam_idx ON reproduction_service(tenant_id, dam_id, service_date DESC);

-- pregnancy_check — outcome of a check (JK-REP-004/005).
CREATE TABLE pregnancy_check (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  dam_id uuid NOT NULL,
  service_id uuid,
  check_date timestamptz NOT NULL,
  method text,
  result text NOT NULL CHECK (result IN ('positive','negative','uncertain','loss')),
  gestation_days_estimate integer CHECK (gestation_days_estimate IS NULL OR gestation_days_estimate >= 0),
  expected_calving_date date,
  event_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (dam_id, tenant_id) REFERENCES animal(id, tenant_id)
);

CREATE INDEX pregnancy_check_dam_idx ON pregnancy_check(tenant_id, dam_id, check_date DESC);

-- calving — a calving event; may create/link a calf (JK-REP-006).
CREATE TABLE calving (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  dam_id uuid NOT NULL,
  service_id uuid,
  calving_date timestamptz NOT NULL,
  ease text CHECK (ease IN ('unassisted','easy_pull','hard_pull','surgical','unknown')),
  outcome text NOT NULL CHECK (outcome IN ('live','stillborn','aborted')),
  calf_id uuid,
  birth_weight_kg numeric CHECK (birth_weight_kg IS NULL OR birth_weight_kg > 0),
  sire_confidence text CHECK (sire_confidence IN ('known','probable','unknown')),
  event_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (dam_id, tenant_id) REFERENCES animal(id, tenant_id),
  FOREIGN KEY (calf_id, tenant_id) REFERENCES animal(id, tenant_id)
);

CREATE INDEX calving_dam_idx ON calving(tenant_id, dam_id, calving_date DESC);

-- animal_parentage — typed, confidence-rated pedigree edges (JK-GEN-001).
CREATE TABLE animal_parentage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  child_id uuid NOT NULL,
  parent_id uuid,
  external_parent_ref text,
  relation text NOT NULL CHECK (relation IN ('dam','sire','donor','recipient')),
  confidence text NOT NULL DEFAULT 'known' CHECK (confidence IN ('known','probable','unknown')),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (child_id, tenant_id) REFERENCES animal(id, tenant_id),
  CHECK (parent_id IS NOT NULL OR external_parent_ref IS NOT NULL)
);

CREATE INDEX animal_parentage_child_idx ON animal_parentage(tenant_id, child_id);
CREATE INDEX animal_parentage_parent_idx ON animal_parentage(tenant_id, parent_id);

-- ---------------------------------------------------------------------------
-- Row-Level Security
-- ---------------------------------------------------------------------------

ALTER TABLE reproduction_service ENABLE ROW LEVEL SECURITY;
ALTER TABLE reproduction_service FORCE ROW LEVEL SECURITY;
ALTER TABLE pregnancy_check ENABLE ROW LEVEL SECURITY;
ALTER TABLE pregnancy_check FORCE ROW LEVEL SECURITY;
ALTER TABLE calving ENABLE ROW LEVEL SECURITY;
ALTER TABLE calving FORCE ROW LEVEL SECURITY;
ALTER TABLE animal_parentage ENABLE ROW LEVEL SECURITY;
ALTER TABLE animal_parentage FORCE ROW LEVEL SECURITY;

CREATE POLICY reproduction_service_tenant_policy ON reproduction_service
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY pregnancy_check_tenant_policy ON pregnancy_check
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY calving_tenant_policy ON calving
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY animal_parentage_tenant_policy ON animal_parentage
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jk_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON reproduction_service, pregnancy_check, calving, animal_parentage TO jk_app';
  END IF;
END
$$;
