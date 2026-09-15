-- Bulk migration of a school that is already operating ("rent roll"):
-- the importacoes ledger plus the text-coercion helpers the importer uses.
--
-- Why a ledger table at all: an import is the single highest-impact write
-- this system accepts — one file can create hundreds of pessoas, alunos,
-- matrículas, contratos, parcelas and pagamentos. logs_acesso (0007) will
-- record each of those rows individually, but it cannot answer the only
-- question anyone actually asks afterwards ("this contract looks wrong —
-- which upload created it, and what did the file say?"). importacoes keeps
-- the submitted payload verbatim, so the raw evidence survives whatever the
-- importer derived from it.

create table importacoes (
  id uuid primary key default gen_random_uuid(),
  escola_id uuid not null references escolas (id),
  criado_por uuid,
  arquivo_nome text,
  status text not null check (status in ('concluida', 'erro')),
  total_linhas int not null check (total_linhas >= 0),
  linhas_importadas int not null default 0 check (linhas_importadas >= 0),
  linhas_ignoradas int not null default 0 check (linhas_ignoradas >= 0),
  -- Raw, exactly as submitted. Never rewritten: a correction is a new
  -- import, not an edit of this row.
  payload jsonb not null,
  relatorio jsonb not null,
  created_at timestamptz not null default now(),
  constraint importacoes_id_escola_unique unique (id, escola_id),
  constraint importacoes_criado_por_fk foreign key (criado_por, escola_id)
    references pessoas (id, escola_id)
);
create index idx_importacoes_escola on importacoes (escola_id);

alter table importacoes enable row level security;

create policy importacoes_select_staff on importacoes for select to authenticated
  using (escola_id = fn_jwt_escola_id() and fn_jwt_role() in ('admin', 'secretaria'));
create policy importacoes_insert_staff on importacoes for insert to authenticated
  with check (escola_id = fn_jwt_escola_id() and fn_jwt_role() in ('admin', 'secretaria'));

-- No update and no delete policy: an import record is append-only history.
grant select, insert on importacoes to authenticated;

-- ── Coercion helpers ──────────────────────────────────────────────────────
--
-- Everything arriving from a spreadsheet is text, written by a human, in
-- Brazilian conventions. These four functions are the only place that
-- guesswork is allowed to happen, and all four return NULL on anything
-- they cannot parse rather than raising — the importer distinguishes
-- "campo vazio" from "campo ilegível" by checking the source text itself,
-- and reports the difference to the user instead of guessing.
--
-- search_path is pinned to pg_catalog: none of the four touches a table or
-- any object in public, so they get the narrowest scope that still works,
-- rather than the "public, pg_temp" used by the functions that read data.

create or replace function fn_import_txt(p_row jsonb, p_key text)
returns text
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select nullif(btrim(coalesce(p_row ->> p_key, '')), '')
$$;

comment on function fn_import_txt (jsonb, text) is
  'Lê um campo textual de uma linha de importação, aparando espaços e tratando string vazia como NULL.';

create or replace function fn_import_data(p_texto text)
returns date
language plpgsql
immutable
set search_path = pg_catalog, pg_temp
as $$
declare
  t text := btrim(coalesce(p_texto, ''));
begin
  if t = '' then
    return null;
  end if;
  -- Aceita as quatro formas que aparecem numa planilha de escola: ISO
  -- (o que o Excel exporta quando a coluna é data), DD/MM/AAAA (o que a
  -- secretaria digita), e as duas equivalentes sem dia, usadas para
  -- competência ("até junho/2026").
  if t ~ '^\d{4}-\d{2}-\d{2}$' then
    return t::date;
  elsif t ~ '^\d{2}/\d{2}/\d{4}$' then
    return to_date(t, 'DD/MM/YYYY');
  elsif t ~ '^\d{4}-\d{2}$' then
    return to_date(t || '-01', 'YYYY-MM-DD');
  elsif t ~ '^\d{2}/\d{4}$' then
    return to_date('01/' || t, 'DD/MM/YYYY');
  end if;
  return null;
exception
  when others then
    -- 31/02/2026 e afins: sintaticamente válido, semanticamente não existe.
    return null;
end;
$$;

comment on function fn_import_data (text) is
  'Converte texto de planilha em date (ISO, DD/MM/AAAA, AAAA-MM, MM/AAAA). NULL quando vazio ou inválido.';

create or replace function fn_import_numero(p_texto text)
returns numeric
language plpgsql
immutable
set search_path = pg_catalog, pg_temp
as $$
declare
  t text := btrim(coalesce(p_texto, ''));
begin
  if t = '' then
    return null;
  end if;
  t := regexp_replace(t, '(R\$|\s)', '', 'g');
  -- "1.234,56" (pt-BR) vs "1234.56" (exportação em locale inglês). A
  -- vírgula é o desempate: se existe, ela é o separador decimal e o ponto
  -- é separador de milhar.
  if position(',' in t) > 0 then
    t := replace(replace(t, '.', ''), ',', '.');
  end if;
  if t !~ '^-?\d+(\.\d+)?$' then
    return null;
  end if;
  return t::numeric;
exception
  when others then
    return null;
end;
$$;

comment on function fn_import_numero (text) is
  'Converte texto de planilha em numeric aceitando formato pt-BR (1.234,56) e inglês (1234.56). NULL quando vazio ou inválido.';

create or replace function fn_import_slug(p_texto text)
returns text
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  -- Normaliza um rótulo digitado à mão para comparação: minúsculas, sem
  -- acentos, sem pontuação. "Mãe", "MAE" e "mae " viram todos 'mae'.
  -- translate() em vez de unaccent(): a extensão unaccent não está
  -- instalada no projeto (ver 0001_extensions.sql) e um IMMUTABLE não pode
  -- depender de algo que pode não existir.
  select nullif(
    regexp_replace(
      translate(
        lower(btrim(coalesce(p_texto, ''))),
        'áàâãäéèêëíìîïóòôõöúùûüçñ',
        'aaaaaeeeeiiiiooooouuuucn'
      ),
      '[^a-z0-9]+', '_', 'g'
    ),
    ''
  )
$$;

comment on function fn_import_slug (text) is
  'Normaliza rótulo de planilha (minúscula, sem acento, sem pontuação) para comparação com enums.';

revoke all on function fn_import_txt (jsonb, text) from public;
revoke all on function fn_import_data (text) from public;
revoke all on function fn_import_numero (text) from public;
revoke all on function fn_import_slug (text) from public;
grant execute on function fn_import_txt (jsonb, text) to authenticated;
grant execute on function fn_import_data (text) to authenticated;
grant execute on function fn_import_numero (text) to authenticated;
grant execute on function fn_import_slug (text) to authenticated;
