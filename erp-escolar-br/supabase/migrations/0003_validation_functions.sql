-- Reusable functions: CPF/CNPJ check-digit validation (spec §6: "CPF e CNPJ
-- validados no banco por constraint, não só no frontend"), the updated_at
-- trigger helper, and thin wrappers over auth.jwt() for the custom claims
-- this schema relies on.
--
-- auth.jwt() itself is not defined here: on a real Supabase project it
-- already exists (GoTrue/PostgREST wire it up). For local development and
-- this test suite against a bare Postgres, tests/support/local-auth-shim.sql
-- provides an equivalent stub — apply it BEFORE these migrations when not
-- running against real Supabase.

create or replace function fn_cpf_valido(cpf text)
returns boolean
language plpgsql
immutable
as $$
declare
  clean text;
  soma int;
  resto int;
  i int;
begin
  if cpf is null then
    return true;
  end if;

  clean := regexp_replace(cpf, '[^0-9]', '', 'g');
  if length(clean) <> 11 then
    return false;
  end if;
  if clean = repeat(substring(clean from 1 for 1), 11) then
    return false;
  end if;

  soma := 0;
  for i in 1..9 loop
    soma := soma + substring(clean from i for 1)::int * (11 - i);
  end loop;
  resto := (soma * 10) % 11;
  if resto = 10 then
    resto := 0;
  end if;
  if resto <> substring(clean from 10 for 1)::int then
    return false;
  end if;

  soma := 0;
  for i in 1..10 loop
    soma := soma + substring(clean from i for 1)::int * (12 - i);
  end loop;
  resto := (soma * 10) % 11;
  if resto = 10 then
    resto := 0;
  end if;
  if resto <> substring(clean from 11 for 1)::int then
    return false;
  end if;

  return true;
end;
$$;

create or replace function fn_cnpj_valido(cnpj text)
returns boolean
language plpgsql
immutable
as $$
declare
  clean text;
  pesos1 int[] := array[5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  pesos2 int[] := array[6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  soma int;
  resto int;
  d1 int;
  d2 int;
  i int;
begin
  if cnpj is null then
    return true;
  end if;

  clean := regexp_replace(cnpj, '[^0-9]', '', 'g');
  if length(clean) <> 14 then
    return false;
  end if;
  if clean = repeat(substring(clean from 1 for 1), 14) then
    return false;
  end if;

  soma := 0;
  for i in 1..12 loop
    soma := soma + substring(clean from i for 1)::int * pesos1[i];
  end loop;
  resto := soma % 11;
  d1 := case when resto < 2 then 0 else 11 - resto end;
  if d1 <> substring(clean from 13 for 1)::int then
    return false;
  end if;

  soma := 0;
  for i in 1..13 loop
    soma := soma + substring(clean from i for 1)::int * pesos2[i];
  end loop;
  resto := soma % 11;
  d2 := case when resto < 2 then 0 else 11 - resto end;
  if d2 <> substring(clean from 14 for 1)::int then
    return false;
  end if;

  return true;
end;
$$;

create or replace function fn_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- escola_id and role are custom JWT claims set server-side at signup/invite
-- time (spec §3.4 for escola_id: "gravado no JWT via custom claim no
-- signup, nunca enviado pelo cliente"). `role` is not explicitly named in
-- the spec's claims list but is required to implement the four-profile
-- model in §3 (rules 5 and 6 depend on knowing the caller's profile) —
-- added here following the same pattern: server-set at invite, never
-- client-writable. See README "Desvios da especificação".
create or replace function fn_jwt_escola_id()
returns uuid
language sql
stable
as $$
  select nullif(auth.jwt() ->> 'escola_id', '')::uuid
$$;

create or replace function fn_jwt_role()
returns text
language sql
stable
as $$
  select auth.jwt() ->> 'role'
$$;
