-- 0002_identity_and_membership.sql
-- Identity and Tenancy bounded context: platform user identity, tenant and
-- farm memberships, roles, and the append-only security audit stream.
-- Requirements: JK-IAM-001..006, JK-SEC-009, §17, §68.

-- User identity is platform-level (one OIDC subject), authorization is
-- membership-scoped per tenant/farm. Deactivation never deletes historical
-- authorship (JK-IAM-005).
CREATE TABLE user_account (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  oidc_subject text UNIQUE,
  email text NOT NULL,
  display_name text NOT NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('invited','active','deactivated')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX user_account_email_unique ON user_account (lower(email));

-- Roles per §17. platform_admin is a platform-level attribute handled outside
-- tenant membership.
CREATE TABLE tenant_membership (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  user_id uuid NOT NULL REFERENCES user_account(id),
  role text NOT NULL CHECK (role IN (
    'tenant_owner','farm_manager','technician','veterinarian',
    'genetics_specialist','finance_user','auditor','integration_service'
  )),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('invited','active','revoked')),
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_to IS NULL OR valid_to > valid_from)
);

CREATE UNIQUE INDEX tenant_membership_active_unique
  ON tenant_membership(tenant_id, user_id, role)
  WHERE valid_to IS NULL;

CREATE INDEX tenant_membership_user_idx ON tenant_membership(user_id);

CREATE TABLE farm_membership (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  farm_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES user_account(id),
  role text NOT NULL CHECK (role IN (
    'farm_manager','technician','veterinarian',
    'genetics_specialist','finance_user','auditor'
  )),
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_to IS NULL OR valid_to > valid_from),
  FOREIGN KEY (farm_id, tenant_id) REFERENCES farm(id, tenant_id)
);

CREATE UNIQUE INDEX farm_membership_active_unique
  ON farm_membership(tenant_id, farm_id, user_id, role)
  WHERE valid_to IS NULL;

-- Append-only security/admin audit stream (JK-SEC-009, §68), distinct from
-- business domain events. tenant_id is NULL for platform-level actions.
CREATE TABLE audit_record (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenant(id),
  actor_type text NOT NULL,
  actor_id text NOT NULL,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id text,
  outcome text NOT NULL CHECK (outcome IN ('success','denied','error')),
  correlation_id uuid,
  source_ip text,
  before_ref text,
  after_ref text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_record_tenant_time_idx ON audit_record(tenant_id, recorded_at DESC);

CREATE TRIGGER audit_record_no_update
  BEFORE UPDATE OR DELETE ON audit_record
  FOR EACH ROW EXECUTE FUNCTION forbid_event_mutation();

-- ---------------------------------------------------------------------------
-- Row-Level Security
-- ---------------------------------------------------------------------------

ALTER TABLE user_account ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_account FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant_membership ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_membership FORCE ROW LEVEL SECURITY;
ALTER TABLE farm_membership ENABLE ROW LEVEL SECURITY;
ALTER TABLE farm_membership FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_record FORCE ROW LEVEL SECURITY;

-- A user account is visible inside a tenant context only when it holds a
-- membership in that tenant. Inserting new accounts (OIDC first login /
-- invitation) is allowed; reads stay membership-scoped.
CREATE POLICY user_account_membership_read ON user_account
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM tenant_membership m
    WHERE m.user_id = user_account.id
      AND m.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  ));

CREATE POLICY user_account_insert ON user_account
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY user_account_update ON user_account
  FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM tenant_membership m
    WHERE m.user_id = user_account.id
      AND m.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  ));

CREATE POLICY tenant_membership_tenant_policy ON tenant_membership
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY farm_membership_tenant_policy ON farm_membership
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY audit_record_tenant_policy ON audit_record
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id IS NULL OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- ---------------------------------------------------------------------------
-- Guarded grants
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jk_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON user_account, tenant_membership, farm_membership TO jk_app';
    EXECUTE 'GRANT SELECT, INSERT ON audit_record TO jk_app';
  END IF;
END
$$;
