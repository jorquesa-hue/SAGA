-- 0016_webhooks_and_connectors.sql
-- Integration architecture (§33) and Webhooks & External Consumers (§51).
--
-- Tenants subscribe to ALLOWLISTED event families only. Deliveries are signed
-- (HMAC over timestamp + delivery id + body) for replay protection, use bounded
-- exponential-backoff retries, land in a dead-letter state, support manual
-- replay, and keep a full delivery log. Secret rotation supports an overlap
-- window (a previous secret stays valid until the next rotation). Connector
-- registrations record tenant-scoped adapter installs behind a stable domain
-- interface; vendor protocol detail never leaks into domain tables.

-- Tenant webhook subscription. `secret_previous` implements rotation overlap
-- (§51): after a rotation both the new and the previous secret verify until the
-- next rotation retires the old one.
CREATE TABLE webhook_subscription (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  url text NOT NULL CHECK (url ~ '^https://'),
  -- Allowlisted event families the subscription receives (enforced in code).
  event_families text[] NOT NULL CHECK (array_length(event_families, 1) >= 1),
  description text,
  secret text NOT NULL,
  secret_previous text,
  secret_rotated_at timestamptz,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  event_id text
);

CREATE INDEX webhook_subscription_active_idx
  ON webhook_subscription(tenant_id, active);

-- One row per (event, subscription) delivery attempt lifecycle. Retention of
-- the raw signed body is deliberate — it is the delivery evidence (§51).
CREATE TABLE webhook_delivery (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  subscription_id uuid NOT NULL REFERENCES webhook_subscription(id),
  -- Stable per-delivery id echoed to the consumer for replay protection (§51).
  delivery_id uuid NOT NULL DEFAULT gen_random_uuid(),
  event_id text NOT NULL,
  event_family text NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','delivering','delivered','failed','dead_letter')),
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 6,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_status_code integer,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  -- A subscription never receives the same event twice.
  UNIQUE (subscription_id, event_id)
);

CREATE INDEX webhook_delivery_due_idx
  ON webhook_delivery(tenant_id, next_attempt_at)
  WHERE status IN ('pending','failed');

CREATE INDEX webhook_delivery_status_idx
  ON webhook_delivery(tenant_id, status, created_at DESC);

-- Append-only delivery attempt log (diagnosis + audit, §51/§68).
CREATE TABLE webhook_delivery_attempt (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  delivery_id uuid NOT NULL REFERENCES webhook_delivery(id),
  attempt_number integer NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('delivered','retryable_error','dead_letter','replayed')),
  status_code integer,
  error text,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX webhook_delivery_attempt_idx
  ON webhook_delivery_attempt(tenant_id, delivery_id, attempt_number);

CREATE TRIGGER webhook_delivery_attempt_no_update
  BEFORE UPDATE OR DELETE ON webhook_delivery_attempt
  FOR EACH ROW EXECUTE FUNCTION forbid_event_mutation();

-- Connector adapter installs behind a stable domain interface (§33). Config is
-- non-secret; credentials are referenced by secret ref, never stored inline.
CREATE TABLE connector_registration (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  connector_type text NOT NULL,
  name text NOT NULL,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','suspended','error')),
  created_at timestamptz NOT NULL DEFAULT now(),
  event_id text,
  UNIQUE (tenant_id, connector_type, name)
);

CREATE INDEX connector_registration_idx
  ON connector_registration(tenant_id, connector_type, status);

ALTER TABLE webhook_subscription ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_subscription FORCE ROW LEVEL SECURITY;
ALTER TABLE webhook_delivery ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_delivery FORCE ROW LEVEL SECURITY;
ALTER TABLE webhook_delivery_attempt ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_delivery_attempt FORCE ROW LEVEL SECURITY;
ALTER TABLE connector_registration ENABLE ROW LEVEL SECURITY;
ALTER TABLE connector_registration FORCE ROW LEVEL SECURITY;

CREATE POLICY webhook_subscription_tenant_policy ON webhook_subscription
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY webhook_delivery_tenant_policy ON webhook_delivery
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY webhook_delivery_attempt_tenant_policy ON webhook_delivery_attempt
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY connector_registration_tenant_policy ON connector_registration
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jk_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON webhook_subscription TO jk_app';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON webhook_delivery TO jk_app';
    EXECUTE 'GRANT SELECT, INSERT ON webhook_delivery_attempt TO jk_app';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON connector_registration TO jk_app';
  END IF;
END
$$;
