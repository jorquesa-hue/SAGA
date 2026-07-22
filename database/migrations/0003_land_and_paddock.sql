-- 0003_land_and_paddock.sql
-- Land and Grazing baseline: geospatial paddocks (§14, JK-PAS-001, core ERD).
-- Full grazing occupation and pasture assessment arrive in Phase 3.

CREATE TABLE paddock (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  farm_id uuid NOT NULL,
  name text NOT NULL,
  area_ha numeric(12,4) CHECK (area_ha IS NULL OR area_ha > 0),
  pasture_type text,
  water_available boolean NOT NULL DEFAULT false,
  geometry geometry(MultiPolygon, 4326),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','retired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (farm_id, tenant_id) REFERENCES farm(id, tenant_id)
);

ALTER TABLE paddock ADD CONSTRAINT paddock_id_tenant_unique UNIQUE (id, tenant_id);

-- Unique active name per farm (§38.1).
CREATE UNIQUE INDEX paddock_active_name_unique
  ON paddock(tenant_id, farm_id, name)
  WHERE status = 'active';

CREATE INDEX paddock_geometry_idx ON paddock USING gist (geometry);

ALTER TABLE paddock ENABLE ROW LEVEL SECURITY;
ALTER TABLE paddock FORCE ROW LEVEL SECURITY;

CREATE POLICY paddock_tenant_policy ON paddock
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jk_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON paddock TO jk_app';
  END IF;
END
$$;
