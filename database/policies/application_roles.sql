-- application_roles.sql — LOCAL / TEST / CI ONLY.
--
-- Provisions the non-superuser application roles that Row-Level Security is
-- enforced against. In staging/production these roles are provisioned by
-- infrastructure (Terraform + secret manager) with strong credentials; this
-- script exists so a clean local or CI database enforces the same RLS model.
-- Passwords below are local-development values, never used outside localhost
-- (same posture as the committed local DATABASE_URL in .env.example).
--
-- Idempotent: safe to run repeatedly. Run BEFORE migrations so guarded grants
-- inside migrations apply to these roles.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jk_app') THEN
    CREATE ROLE jk_app LOGIN PASSWORD 'jk_app_local';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jk_worker') THEN
    CREATE ROLE jk_worker LOGIN PASSWORD 'jk_worker_local';
  END IF;
END
$$;
