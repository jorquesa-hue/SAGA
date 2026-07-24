-- 0014_genetics.sql
-- Genetics: imported DEP/EBV evaluations (with provenance) and versioned
-- selection indexes. Requirements: JK-GEN-002/004/005/006, §12.3, §22.

-- genetic_evaluation — an imported provider evaluation for one animal+trait,
-- retaining provider, evaluation date, percentile, reliability, and source
-- file (JK-GEN-002). Imported values are never independently re-derived.
CREATE TABLE genetic_evaluation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  animal_id uuid NOT NULL,
  provider text NOT NULL,
  evaluation_date date NOT NULL,
  trait text NOT NULL,
  value numeric NOT NULL,
  percentile numeric CHECK (percentile IS NULL OR (percentile >= 0 AND percentile <= 100)),
  reliability numeric CHECK (reliability IS NULL OR (reliability >= 0 AND reliability <= 1)),
  source_file text,
  imported_at timestamptz NOT NULL DEFAULT now(),
  event_id text,
  FOREIGN KEY (animal_id, tenant_id) REFERENCES animal(id, tenant_id),
  UNIQUE (tenant_id, animal_id, provider, evaluation_date, trait)
);

CREATE INDEX genetic_evaluation_animal_idx ON genetic_evaluation(tenant_id, animal_id, trait);

-- selection_index — a versioned index formula (trait weights + missing-data
-- behavior), so historical rankings are reproducible (JK-GEN-004).
CREATE TABLE selection_index (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  name text NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  weights jsonb NOT NULL,
  missing_data_behavior text NOT NULL DEFAULT 'exclude'
    CHECK (missing_data_behavior IN ('exclude','treat_as_zero')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name, version)
);

ALTER TABLE genetic_evaluation ENABLE ROW LEVEL SECURITY;
ALTER TABLE genetic_evaluation FORCE ROW LEVEL SECURITY;
ALTER TABLE selection_index ENABLE ROW LEVEL SECURITY;
ALTER TABLE selection_index FORCE ROW LEVEL SECURITY;

CREATE POLICY genetic_evaluation_tenant_policy ON genetic_evaluation
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY selection_index_tenant_policy ON selection_index
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jk_app') THEN
    EXECUTE 'GRANT SELECT, INSERT ON genetic_evaluation TO jk_app';
    EXECUTE 'GRANT SELECT, INSERT ON selection_index TO jk_app';
  END IF;
END
$$;
