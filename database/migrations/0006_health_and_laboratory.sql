-- 0006_health_and_laboratory.sql
-- Health and Laboratory: protocols, treatments/vaccinations with medicine
-- traceability and withdrawal periods, animal restriction state, and clinical
-- cases. Requirements: JK-HLT-001..006, JK-DOM-011, §13, §23.

-- ---------------------------------------------------------------------------
-- health_protocol — versioned protocol by species/age/class/farm (JK-HLT-001).
-- The schedule (doses by age/interval) is JSONB; a canonical schedule model
-- arrives with due-task generation.
-- ---------------------------------------------------------------------------

CREATE TABLE health_protocol (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  farm_id uuid,
  name text NOT NULL,
  species_code text NOT NULL DEFAULT 'BOVINE',
  applies_to text,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  schedule jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','retired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (farm_id, tenant_id) REFERENCES farm(id, tenant_id)
);

CREATE UNIQUE INDEX health_protocol_active_name_unique
  ON health_protocol(tenant_id, name, version);

-- ---------------------------------------------------------------------------
-- treatment — an administered vaccination or treatment (JK-HLT-004). Medicine
-- batch, dose/unit, route, administrator, date, and withdrawal are mandatory
-- when applicable.
-- ---------------------------------------------------------------------------

CREATE TABLE treatment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  animal_id uuid NOT NULL,
  protocol_id uuid,
  kind text NOT NULL CHECK (kind IN ('vaccination','treatment')),
  product_name text NOT NULL,
  medicine_batch text,
  dose numeric CHECK (dose IS NULL OR dose > 0),
  dose_unit text,
  route text,
  administered_by uuid,
  administered_at timestamptz NOT NULL,
  withdrawal_until timestamptz,
  notes text,
  event_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (animal_id, tenant_id) REFERENCES animal(id, tenant_id),
  CHECK (withdrawal_until IS NULL OR withdrawal_until > administered_at)
);

CREATE INDEX treatment_animal_idx ON treatment(tenant_id, animal_id, administered_at DESC);

-- ---------------------------------------------------------------------------
-- animal_restriction — restriction state with a due date (JK-DOM-011). A
-- treatment with a withdrawal period generates a 'withdrawal' restriction that
-- is active until valid_to, blocking sale-clear (JK-HLT-005) unless an
-- authorized, documented override lifts it.
-- ---------------------------------------------------------------------------

CREATE TABLE animal_restriction (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  animal_id uuid NOT NULL,
  restriction_type text NOT NULL CHECK (restriction_type IN ('withdrawal','health_hold','quarantine')),
  source_treatment_id uuid,
  reason text,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','lifted','overridden')),
  lifted_by uuid,
  lifted_reason text,
  lifted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (animal_id, tenant_id) REFERENCES animal(id, tenant_id)
);

-- Fast active-restriction lookup for the sale-clear check.
CREATE INDEX animal_restriction_active_idx
  ON animal_restriction(tenant_id, animal_id)
  WHERE status = 'active';

-- ---------------------------------------------------------------------------
-- health_case — clinical case linking observation → diagnosis → outcome
-- (JK-HLT-006, §13 distinguishes symptom/observation/diagnosis/treatment/outcome).
-- ---------------------------------------------------------------------------

CREATE TABLE health_case (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  animal_id uuid NOT NULL,
  opened_by uuid,
  opened_at timestamptz NOT NULL DEFAULT now(),
  symptom text,
  diagnosis text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  outcome text,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (animal_id, tenant_id) REFERENCES animal(id, tenant_id)
);

CREATE INDEX health_case_animal_idx ON health_case(tenant_id, animal_id, opened_at DESC);

-- ---------------------------------------------------------------------------
-- Row-Level Security
-- ---------------------------------------------------------------------------

ALTER TABLE health_protocol ENABLE ROW LEVEL SECURITY;
ALTER TABLE health_protocol FORCE ROW LEVEL SECURITY;
ALTER TABLE treatment ENABLE ROW LEVEL SECURITY;
ALTER TABLE treatment FORCE ROW LEVEL SECURITY;
ALTER TABLE animal_restriction ENABLE ROW LEVEL SECURITY;
ALTER TABLE animal_restriction FORCE ROW LEVEL SECURITY;
ALTER TABLE health_case ENABLE ROW LEVEL SECURITY;
ALTER TABLE health_case FORCE ROW LEVEL SECURITY;

CREATE POLICY health_protocol_tenant_policy ON health_protocol
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY treatment_tenant_policy ON treatment
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY animal_restriction_tenant_policy ON animal_restriction
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY health_case_tenant_policy ON health_case
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jk_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON health_protocol, treatment, animal_restriction, health_case TO jk_app';
  END IF;
END
$$;
