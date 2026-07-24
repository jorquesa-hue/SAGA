-- 0008_lots_and_movements.sql
-- Herd Operations: operational lots, temporal lot membership (one primary lot
-- per animal), and paddock occupation/movements. Current lot and location are
-- projections of these temporal facts. Requirements: JK-HER-001..005, §10, §20.

-- lot — an operational grouping with purpose and temporal lifecycle (JK-HER-001).
CREATE TABLE lot (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  farm_id uuid NOT NULL,
  name text NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('genetic_nucleus','beef','rearing','quarantine','other')),
  target text,
  responsible_id uuid,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (farm_id, tenant_id) REFERENCES farm(id, tenant_id)
);

ALTER TABLE lot ADD CONSTRAINT lot_id_tenant_unique UNIQUE (id, tenant_id);
CREATE UNIQUE INDEX lot_active_name_unique ON lot(tenant_id, farm_id, name) WHERE status = 'open';

-- lot_membership — temporal membership (JK-HER-002). One active PRIMARY
-- operational lot per animal is enforced by the partial unique index below.
CREATE TABLE lot_membership (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  lot_id uuid NOT NULL,
  animal_id uuid NOT NULL,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_to IS NULL OR valid_to > valid_from),
  FOREIGN KEY (lot_id, tenant_id) REFERENCES lot(id, tenant_id),
  FOREIGN KEY (animal_id, tenant_id) REFERENCES animal(id, tenant_id)
);

-- JK-HER-002 / §10: an animal has at most one active operational lot membership.
CREATE UNIQUE INDEX lot_membership_one_active_per_animal
  ON lot_membership(tenant_id, animal_id) WHERE valid_to IS NULL;
CREATE INDEX lot_membership_lot_idx ON lot_membership(tenant_id, lot_id) WHERE valid_to IS NULL;

-- paddock_occupation — a lot occupying a paddock over time. Moving closes the
-- previous occupation before opening the next (JK-HER-003, §14).
CREATE TABLE paddock_occupation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  paddock_id uuid NOT NULL,
  lot_id uuid NOT NULL,
  entry_at timestamptz NOT NULL DEFAULT now(),
  exit_at timestamptz,
  head_count integer CHECK (head_count IS NULL OR head_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (exit_at IS NULL OR exit_at > entry_at),
  FOREIGN KEY (paddock_id, tenant_id) REFERENCES paddock(id, tenant_id),
  FOREIGN KEY (lot_id, tenant_id) REFERENCES lot(id, tenant_id)
);

-- One open occupation per lot (a lot is in one paddock at a time).
CREATE UNIQUE INDEX paddock_occupation_one_open_per_lot
  ON paddock_occupation(tenant_id, lot_id) WHERE exit_at IS NULL;
CREATE INDEX paddock_occupation_paddock_idx
  ON paddock_occupation(tenant_id, paddock_id) WHERE exit_at IS NULL;

-- ---------------------------------------------------------------------------
-- Row-Level Security
-- ---------------------------------------------------------------------------

ALTER TABLE lot ENABLE ROW LEVEL SECURITY;
ALTER TABLE lot FORCE ROW LEVEL SECURITY;
ALTER TABLE lot_membership ENABLE ROW LEVEL SECURITY;
ALTER TABLE lot_membership FORCE ROW LEVEL SECURITY;
ALTER TABLE paddock_occupation ENABLE ROW LEVEL SECURITY;
ALTER TABLE paddock_occupation FORCE ROW LEVEL SECURITY;

CREATE POLICY lot_tenant_policy ON lot
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY lot_membership_tenant_policy ON lot_membership
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY paddock_occupation_tenant_policy ON paddock_occupation
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jk_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON lot, lot_membership, paddock_occupation TO jk_app';
  END IF;
END
$$;
