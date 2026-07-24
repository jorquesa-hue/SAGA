-- 0012_assets_maintenance.sql
-- Assets and Maintenance: asset register, maintenance/calibration schedules,
-- and work orders. Requirements: JK-AST-001..005, §15.3, §25.

CREATE TABLE asset (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  farm_id uuid,
  name text NOT NULL,
  asset_type text NOT NULL CHECK (asset_type IN
    ('scale','rfid_reader','gateway','vehicle','machinery','pump','fence','water_system','corral','other')),
  model text,
  serial text,
  location text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','maintenance','retired')),
  responsible_id uuid,
  calibration_valid_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (farm_id, tenant_id) REFERENCES farm(id, tenant_id)
);

ALTER TABLE asset ADD CONSTRAINT asset_id_tenant_unique UNIQUE (id, tenant_id);
CREATE INDEX asset_type_idx ON asset(tenant_id, asset_type, status);

CREATE TABLE maintenance_schedule (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  asset_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('preventive','calibration')),
  interval_days integer NOT NULL CHECK (interval_days > 0),
  last_done_at timestamptz,
  next_due_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (asset_id, tenant_id) REFERENCES asset(id, tenant_id)
);

CREATE INDEX maintenance_schedule_due_idx ON maintenance_schedule(tenant_id, next_due_at);

CREATE TABLE work_order (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  asset_id uuid NOT NULL,
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  description text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','done','cancelled')),
  labor_cost numeric CHECK (labor_cost IS NULL OR labor_cost >= 0),
  parts_cost numeric CHECK (parts_cost IS NULL OR parts_cost >= 0),
  downtime_hours numeric CHECK (downtime_hours IS NULL OR downtime_hours >= 0),
  opened_by uuid,
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (asset_id, tenant_id) REFERENCES asset(id, tenant_id)
);

CREATE INDEX work_order_asset_idx ON work_order(tenant_id, asset_id, status);

ALTER TABLE asset ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset FORCE ROW LEVEL SECURITY;
ALTER TABLE maintenance_schedule ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_schedule FORCE ROW LEVEL SECURITY;
ALTER TABLE work_order ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_order FORCE ROW LEVEL SECURITY;

CREATE POLICY asset_tenant_policy ON asset
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY maintenance_schedule_tenant_policy ON maintenance_schedule
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY work_order_tenant_policy ON work_order
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jk_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON asset, maintenance_schedule, work_order TO jk_app';
  END IF;
END
$$;
