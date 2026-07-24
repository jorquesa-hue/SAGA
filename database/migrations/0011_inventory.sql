-- 0011_inventory.sql
-- Nutrition and Inventory: item master, batches with expiration, and an
-- immutable stock-movement ledger with calculated balances. Requirements:
-- JK-INV-001..005, §15.1.

CREATE TABLE item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  name text NOT NULL,
  category text NOT NULL CHECK (category IN ('feed','mineral','medicine','tag','consumable','other')),
  unit text NOT NULL,
  supplier text,
  reorder_level numeric CHECK (reorder_level IS NULL OR reorder_level >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

ALTER TABLE item ADD CONSTRAINT item_id_tenant_unique UNIQUE (id, tenant_id);

CREATE TABLE item_batch (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  item_id uuid NOT NULL,
  batch_code text NOT NULL,
  expiration_date date,
  received_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (item_id, tenant_id) REFERENCES item(id, tenant_id),
  UNIQUE (tenant_id, item_id, batch_code)
);

ALTER TABLE item_batch ADD CONSTRAINT item_batch_id_tenant_unique UNIQUE (id, tenant_id);
CREATE INDEX item_batch_expiration_idx ON item_batch(tenant_id, expiration_date);

-- Immutable stock ledger (JK-INV-002): balance = SUM(quantity_delta).
-- Receipts are positive; consumption/disposal negative; adjustments signed.
CREATE TABLE stock_movement (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  item_id uuid NOT NULL,
  batch_id uuid,
  movement_type text NOT NULL CHECK (movement_type IN ('receipt','consumption','transfer','adjustment','disposal')),
  quantity_delta numeric NOT NULL,
  unit text NOT NULL,
  -- Consumption linkage (JK-INV-003).
  animal_id uuid,
  lot_id uuid,
  paddock_id uuid,
  work_order_id uuid,
  reason text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  event_id text,
  FOREIGN KEY (item_id, tenant_id) REFERENCES item(id, tenant_id),
  FOREIGN KEY (batch_id, tenant_id) REFERENCES item_batch(id, tenant_id)
);

CREATE INDEX stock_movement_item_idx ON stock_movement(tenant_id, item_id, occurred_at);

-- Ledger immutability (JK-INV-002, JK-CON-003): adjustments are new movements.
CREATE TRIGGER stock_movement_no_update
  BEFORE UPDATE OR DELETE ON stock_movement
  FOR EACH ROW EXECUTE FUNCTION forbid_event_mutation();

ALTER TABLE item ENABLE ROW LEVEL SECURITY;
ALTER TABLE item FORCE ROW LEVEL SECURITY;
ALTER TABLE item_batch ENABLE ROW LEVEL SECURITY;
ALTER TABLE item_batch FORCE ROW LEVEL SECURITY;
ALTER TABLE stock_movement ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movement FORCE ROW LEVEL SECURITY;

CREATE POLICY item_tenant_policy ON item
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY item_batch_tenant_policy ON item_batch
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY stock_movement_tenant_policy ON stock_movement
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jk_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON item, item_batch TO jk_app';
    EXECUTE 'GRANT SELECT, INSERT ON stock_movement TO jk_app';
  END IF;
END
$$;
