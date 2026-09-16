-- Pin search_path on every function (prevents search_path hijacking via a
-- role-mutable path); Supabase's advisor flags this on any function that
-- omits it, DEFINER or not.
alter function fn_cpf_valido(text) set search_path = public, pg_temp;
alter function fn_cnpj_valido(text) set search_path = public, pg_temp;
alter function fn_set_updated_at() set search_path = public, pg_temp;
alter function fn_jwt_escola_id() set search_path = public, pg_temp;
alter function fn_jwt_role() set search_path = public, pg_temp;

-- Supabase grants EXECUTE on every new public-schema function to
-- anon/authenticated/service_role by default (via ALTER DEFAULT
-- PRIVILEGES at the database level), which re-applies regardless of an
-- explicit `revoke ... from public` issued at CREATE FUNCTION time. Close
-- the two SECURITY DEFINER functions back down explicitly:
--   - fn_log_acesso() is trigger-only; trigger firing does not require the
--     invoking role to hold EXECUTE, so revoking it from every role here
--     does not break the audit trigger, it only removes the accidental
--     public RPC endpoint at /rest/v1/rpc/fn_log_acesso.
--   - fn_current_pessoa_id() is called from inside RLS policies by the
--     `authenticated` role, which must keep EXECUTE for those policies to
--     evaluate; `anon` has no policies that call it and gets no grant.
--     `authenticated` can also call it directly as an RPC — accepted: it
--     only ever returns the caller's own pessoa id (scoped by auth.uid()
--     and the caller's own escola_id claim), so there is no cross-tenant
--     or cross-person leak through that path.
revoke execute on function fn_log_acesso() from public, anon, authenticated;
revoke execute on function fn_current_pessoa_id() from public, anon;
grant execute on function fn_current_pessoa_id() to authenticated;
