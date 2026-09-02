-- Makes RLS work without the Custom Access Token Hook.
--
-- Until now fn_jwt_escola_id()/fn_jwt_role() read the `escola_id` /
-- `escola_role` claims that 0011's custom_access_token_hook stamps into
-- the JWT. Enabling that hook is a Supabase *dashboard* action (Auth →
-- Hooks) with no SQL or Management-API-free equivalent, so on any project
-- where nobody has flipped that switch both functions return NULL and
-- every role-scoped policy denies — the whole app renders empty for a
-- legitimately logged-in user.
--
-- These definitions derive the same two values from the caller's own
-- `pessoas` row via auth.uid() instead, which:
--   1. works whether or not the hook is enabled (the hook may stay on;
--      its claims simply stop being read);
--   2. is *more* correct on revocation — a JWT keeps its stamped claims
--      until it expires, so a demoted admin stayed admin for the life of
--      their token; the table is read fresh on every statement;
--   3. keeps identical semantics to the hook, including picking the
--      highest-privilege papel (pessoa_papel is declared admin <
--      secretaria < professor < responsavel < aluno, so min() is the most
--      privileged), and returning NULL when a person has no papeis.
--
-- SECURITY DEFINER is required, not incidental: policies *on* pessoas
-- call these, so a SECURITY INVOKER lookup of pessoas would recurse
-- through the very policy being evaluated. Definer rights bypass RLS
-- inside the function body, exactly as fn_current_pessoa_id() (0003)
-- already does. Neither function takes arguments and both return only
-- the caller's own row, so there is no injection or cross-tenant surface.
-- Supabase's linter flags any SECURITY DEFINER function executable by
-- `authenticated`; these two are accepted for that reason, alongside the
-- already-documented fn_current_pessoa_id finding.
--
-- Lookup cost is a single index probe: uq_pessoas_auth_user is a unique
-- index on (auth_user_id) where auth_user_id is not null.

create or replace function fn_jwt_escola_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.escola_id
  from pessoas p
  where p.auth_user_id = auth.uid()
    and p.deleted_at is null
  limit 1
$$;

create or replace function fn_jwt_role()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select (select min(papel)::text from unnest(p.papeis) as papel)
  from pessoas p
  where p.auth_user_id = auth.uid()
    and p.deleted_at is null
  limit 1
$$;
