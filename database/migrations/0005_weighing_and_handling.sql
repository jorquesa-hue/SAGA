-- 0005_weighing_and_handling.sql
-- Herd Operations: handling sessions, the raw device-observation ledger, and
-- the validated animal-weight read model. Requirements: JK-WGT-001..008,
-- JK-DOM-009 (raw payload preserved), §11 (weight/growth rules), §19.

-- ---------------------------------------------------------------------------
-- handling_session — a coordinated field operation (weighing, vaccination…)
-- grouping observations and actions (§10, JK-WGT-001).
-- ---------------------------------------------------------------------------

CREATE TABLE handling_session (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  farm_id uuid NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('weighing','vaccination','pregnancy_check','treatment','handling','other')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  device_id text,
  operator_id uuid,
  expected_count integer CHECK (expected_count IS NULL OR expected_count >= 0),
  started_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  summary jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (farm_id, tenant_id) REFERENCES farm(id, tenant_id)
);

ALTER TABLE handling_session ADD CONSTRAINT handling_session_id_tenant_unique UNIQUE (id, tenant_id);
CREATE INDEX handling_session_farm_idx ON handling_session(tenant_id, farm_id, started_at DESC);

-- ---------------------------------------------------------------------------
-- device_observation — raw hardware/manual observation ledger. Preserves the
-- raw payload, parsing result, quality flags, and resolved domain event
-- (JK-DOM-009, JK-WGT-004). Idempotent per (tenant, gateway, observation id).
-- ---------------------------------------------------------------------------

CREATE TABLE device_observation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  handling_session_id uuid,
  gateway_id text NOT NULL DEFAULT 'manual',
  device_id text,
  observation_id text NOT NULL,
  captured_at timestamptz NOT NULL,
  measurement_type text NOT NULL CHECK (measurement_type IN ('weight')),
  raw_value numeric,
  unit text,
  rfid text,
  raw_payload jsonb,
  quality_flags text[] NOT NULL DEFAULT '{}',
  resolution_status text NOT NULL
    CHECK (resolution_status IN ('accepted','duplicate','pending_resolution','rejected_validation','retryable_error')),
  resolved_animal_id uuid,
  normalized_weight_kg numeric,
  event_id text,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (handling_session_id, tenant_id) REFERENCES handling_session(id, tenant_id)
);

-- Idempotent replay: the same device observation id under the same gateway
-- is recorded once per tenant (JK-WGT-008, store-and-forward).
CREATE UNIQUE INDEX device_observation_idem_unique
  ON device_observation(tenant_id, gateway_id, observation_id);

CREATE INDEX device_observation_session_idx
  ON device_observation(tenant_id, handling_session_id);
-- Exception queue: unresolved / rejected observations (JK-WGT-003, never discarded).
CREATE INDEX device_observation_exceptions_idx
  ON device_observation(tenant_id, resolution_status)
  WHERE resolution_status IN ('pending_resolution','rejected_validation','retryable_error');

-- ---------------------------------------------------------------------------
-- animal_weight — validated weight read model for trend/ADG (§11, §42).
-- Rebuildable from animal.weight_recorded.v1 events; original measured value
-- stays immutable in the event ledger and device_observation.
-- ---------------------------------------------------------------------------

CREATE TABLE animal_weight (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  animal_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL,
  weight_kg numeric NOT NULL CHECK (weight_kg > 0),
  eligible_for_analytics boolean NOT NULL DEFAULT true,
  quality_flags text[] NOT NULL DEFAULT '{}',
  source_observation_id uuid,
  event_id text NOT NULL,
  calculated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, event_id)
);

CREATE INDEX animal_weight_trend_idx
  ON animal_weight(tenant_id, animal_id, occurred_at);

-- ---------------------------------------------------------------------------
-- Row-Level Security
-- ---------------------------------------------------------------------------

ALTER TABLE handling_session ENABLE ROW LEVEL SECURITY;
ALTER TABLE handling_session FORCE ROW LEVEL SECURITY;
ALTER TABLE device_observation ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_observation FORCE ROW LEVEL SECURITY;
ALTER TABLE animal_weight ENABLE ROW LEVEL SECURITY;
ALTER TABLE animal_weight FORCE ROW LEVEL SECURITY;

CREATE POLICY handling_session_tenant_policy ON handling_session
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY device_observation_tenant_policy ON device_observation
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY animal_weight_tenant_policy ON animal_weight
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- ---------------------------------------------------------------------------
-- Grants. jk_app operates all three; jk_worker may maintain the animal_weight
-- projection (it rebuilds from events).
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jk_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON handling_session, device_observation, animal_weight TO jk_app';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jk_worker') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON animal_weight TO jk_worker';
    EXECUTE 'CREATE POLICY animal_weight_worker_policy ON animal_weight TO jk_worker USING (true) WITH CHECK (true)';
  END IF;
END
$$;
