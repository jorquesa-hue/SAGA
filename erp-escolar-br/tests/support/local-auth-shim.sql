-- TEST-ONLY shim that mimics the parts of a real Supabase Postgres project
-- our migrations depend on: the `auth` schema's jwt()/uid() functions, and
-- the `authenticated`/`anon` roles PostgREST connects as.
--
-- Do NOT apply this to a real Supabase project — auth.jwt(), auth.uid(),
-- and the authenticated/anon roles already exist there, provided by
-- GoTrue/PostgREST. This file exists solely so supabase/migrations/*.sql
-- can be exercised against a bare `postgres:16` container in CI/local dev
-- without standing up the full Supabase stack. Apply it BEFORE the
-- versioned migrations (scripts/db-reset.mjs does this when
-- LOCAL_TEST_SHIM=1).
--
-- Real Supabase reads the caller's JWT claims into the
-- `request.jwt.claims` GUC per request (PostgREST sets it from the
-- Authorization header); this shim reads the same GUC, so policies written
-- against auth.jwt() behave identically in both environments.

create schema if not exists auth;

create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
$$;

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid
$$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'app_test_user') then
    create role app_test_user login password 'local_test_only_password' in role authenticated;
  end if;
end
$$;

grant usage on schema auth to authenticated, anon;
grant execute on function auth.jwt() to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;
