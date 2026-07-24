-- 0013_finance_commerce.sql
-- Finance and Commerce: operational financial subledger (expenses/revenue),
-- split allocation across dimensions, animal/lot sales, and monthly budgets.
-- Requirements: JK-FIN-001..007, JK-DOM-008, §15.2. First release is an
-- operational subledger, not a statutory general ledger.

-- financial_entry — immutable subledger entry (JK-DOM-008: currency, original
-- amount, allocation basis). Amounts are stored as integer minor units to
-- avoid floating point; corrections are reversal + re-entry (§40).
CREATE TABLE financial_entry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  farm_id uuid,
  entry_type text NOT NULL CHECK (entry_type IN ('expense','revenue')),
  category text NOT NULL,
  counterparty text,
  amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
  currency char(3) NOT NULL DEFAULT 'BRL',
  capex_opex text CHECK (capex_opex IN ('capex','opex')),
  reverses_entry_id uuid,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  event_id text,
  FOREIGN KEY (farm_id, tenant_id) REFERENCES farm(id, tenant_id)
);

ALTER TABLE financial_entry ADD CONSTRAINT financial_entry_id_tenant_unique UNIQUE (id, tenant_id);
CREATE INDEX financial_entry_idx ON financial_entry(tenant_id, entry_type, occurred_at DESC);

CREATE TRIGGER financial_entry_no_update
  BEFORE UPDATE OR DELETE ON financial_entry
  FOR EACH ROW EXECUTE FUNCTION forbid_event_mutation();

-- financial_allocation — split of an entry across dimensions (JK-FIN-002/003).
-- allocated_minor sums (per entry) to the entry amount; the allocation rule
-- version is disclosed for reproducibility.
CREATE TABLE financial_allocation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  entry_id uuid NOT NULL,
  dimension text NOT NULL CHECK (dimension IN ('farm','paddock','lot','animal','asset','project')),
  target_id uuid,
  target_ref text,
  allocated_minor bigint NOT NULL,
  allocation_rule_version text NOT NULL DEFAULT 'v1',
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (entry_id, tenant_id) REFERENCES financial_entry(id, tenant_id)
);

CREATE INDEX financial_allocation_target_idx
  ON financial_allocation(tenant_id, dimension, target_id);

-- sale — an animal or lot sale producing a revenue entry (JK-FIN-005).
CREATE TABLE sale (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  entry_id uuid,
  animal_id uuid,
  lot_id uuid,
  weight_kg numeric CHECK (weight_kg IS NULL OR weight_kg > 0),
  price_basis text,
  gross_minor bigint NOT NULL CHECK (gross_minor >= 0),
  deductions_minor bigint NOT NULL DEFAULT 0 CHECK (deductions_minor >= 0),
  freight_minor bigint NOT NULL DEFAULT 0 CHECK (freight_minor >= 0),
  net_receipt_minor bigint NOT NULL,
  currency char(3) NOT NULL DEFAULT 'BRL',
  sold_at timestamptz NOT NULL DEFAULT now(),
  event_id text,
  FOREIGN KEY (animal_id, tenant_id) REFERENCES animal(id, tenant_id),
  FOREIGN KEY (entry_id, tenant_id) REFERENCES financial_entry(id, tenant_id)
);

CREATE INDEX sale_idx ON sale(tenant_id, sold_at DESC);

-- budget — monthly planned amount by category (JK-FIN-004).
CREATE TABLE budget (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  farm_id uuid,
  period_month date NOT NULL,
  category text NOT NULL,
  planned_minor bigint NOT NULL CHECK (planned_minor >= 0),
  currency char(3) NOT NULL DEFAULT 'BRL',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, farm_id, period_month, category)
);

ALTER TABLE financial_entry ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_entry FORCE ROW LEVEL SECURITY;
ALTER TABLE financial_allocation ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_allocation FORCE ROW LEVEL SECURITY;
ALTER TABLE sale ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale FORCE ROW LEVEL SECURITY;
ALTER TABLE budget ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget FORCE ROW LEVEL SECURITY;

CREATE POLICY financial_entry_tenant_policy ON financial_entry
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY financial_allocation_tenant_policy ON financial_allocation
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY sale_tenant_policy ON sale
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY budget_tenant_policy ON budget
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jk_app') THEN
    EXECUTE 'GRANT SELECT, INSERT ON financial_entry, financial_allocation, sale TO jk_app';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON budget TO jk_app';
  END IF;
END
$$;
