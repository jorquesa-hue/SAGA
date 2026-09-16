-- Closes the RPC surface that 0017 opened.
--
-- 0017 turned fn_jwt_escola_id()/fn_jwt_role() into SECURITY DEFINER
-- functions (required so policies on `pessoas` can look up `pessoas`
-- without recursing). Supabase's default privileges grant EXECUTE on every
-- new public-schema function to anon/authenticated/service_role, so both
-- immediately became callable at /rest/v1/rpc/... by anonymous callers —
-- flagged by the advisor as anon_security_definer_function_executable.
--
-- No data leak was possible through that path (auth.uid() is NULL for an
-- anonymous caller, so both functions return NULL rather than another
-- tenant's value), but there is no reason to expose them: all 67 RLS
-- policies in this schema target the `authenticated` role only, so `anon`
-- never evaluates a policy that calls either function and needs no grant.
--
-- `authenticated` must keep EXECUTE — RLS policy expressions are evaluated
-- as the querying role, so revoking it there would break every policy.
-- Same accepted trade-off already documented for fn_current_pessoa_id() in
-- 0009: a signed-in caller can invoke them directly as an RPC, but they
-- take no arguments and return only that caller's own escola_id/papel.
revoke execute on function fn_jwt_escola_id() from public, anon;
revoke execute on function fn_jwt_role() from public, anon;
grant execute on function fn_jwt_escola_id() to authenticated;
grant execute on function fn_jwt_role() to authenticated;
