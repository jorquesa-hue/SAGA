-- Custom Access Token Hook (spec §3.4: escola_id "gravado no JWT via
-- custom claim no signup, nunca enviado pelo cliente"; escola_role is our
-- own addition following the same pattern — see README "Desvios da
-- especificação"). Runs on every token issuance/refresh and stamps
-- escola_id + escola_role from the caller's own pessoas row, looked up by
-- auth_user_id — never from anything the client sends.
--
-- Priority when a pessoa holds multiple papeis (spec §4 explicitly allows
-- a person to be e.g. professor AND responsavel): pessoa_papel's enum
-- declaration order IS the priority (admin, secretaria, professor,
-- responsavel, aluno), so MIN() over the array picks the highest one. This
-- is a deliberate MVP simplification — a future "act as" role switcher
-- could let a dual-role person choose per session instead.
--
-- NOTE: enabling this hook still requires ONE manual step in the Supabase
-- Dashboard (Authentication > Hooks > Custom Access Token > select
-- "custom_access_token_hook" > Enable) — no tool in this session's access
-- can flip that project-config toggle. See erp-escolar-br/README.md. On a
-- bare local Postgres (tests/support/local-auth-shim.sql), the
-- supabase_auth_admin role exists only so this migration's GRANT applies
-- cleanly — nothing locally invokes the hook itself, since there is no
-- GoTrue.
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid;
  v_escola_id uuid;
  v_papeis pessoa_papel[];
  v_claims jsonb;
begin
  v_user_id := (event ->> 'user_id')::uuid;
  v_claims := event -> 'claims';

  select p.escola_id, p.papeis
    into v_escola_id, v_papeis
    from pessoas p
    where p.auth_user_id = v_user_id
      and p.deleted_at is null
    limit 1;

  if v_escola_id is not null then
    v_claims := jsonb_set(v_claims, '{escola_id}', to_jsonb(v_escola_id::text));
    if v_papeis is not null and array_length(v_papeis, 1) > 0 then
      v_claims := jsonb_set(
        v_claims,
        '{escola_role}',
        to_jsonb((select min(papel)::text from unnest(v_papeis) as papel))
      );
    end if;
  end if;

  return jsonb_set(event, '{claims}', v_claims);
end;
$$;

grant select on table public.pessoas to supabase_auth_admin;

grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;
