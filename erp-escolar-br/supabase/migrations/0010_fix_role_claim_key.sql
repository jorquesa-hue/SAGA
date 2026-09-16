-- Supabase's JWT spec reserves the top-level `role` claim exclusively for
-- `anon`/`authenticated` (PostgREST reads it to pick the Postgres role for
-- the request). Our custom profile claim must not collide with it — rename
-- the claim key this function reads from `role` to `escola_role`. The
-- function name itself is unchanged (all RLS policies already call
-- fn_jwt_role(), so no policy needs editing), only what JWT key it reads.
create or replace function fn_jwt_role()
returns text
language sql
stable
set search_path = public, pg_temp
as $$
  select auth.jwt() ->> 'escola_role'
$$;
