-- 0019_tenant_settings_update.sql
-- Allow the application role to update a tenant's own configurable settings
-- (base locale/currency) via the Identity service (§45, JK-IAM). The write is
-- authorized in-application (manage_tenant → tenant_owner) and constrained by
-- the existing tenant_self_policy RLS: the row must satisfy
-- id = current_setting('app.tenant_id'); the UPDATE never changes id, so the
-- WITH CHECK (which defaults to the USING clause) holds. Only the table-level
-- UPDATE grant was missing.
--
-- Migrations are immutable after release; 0001 granted SELECT, INSERT on tenant
-- to jk_app and UPDATE on farm/animal/animal_identifier. This adds UPDATE on
-- tenant. Guarded so it also applies where jk_app is provisioned externally.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jk_app') THEN
    EXECUTE 'GRANT UPDATE ON tenant TO jk_app';
  END IF;
END
$$;
