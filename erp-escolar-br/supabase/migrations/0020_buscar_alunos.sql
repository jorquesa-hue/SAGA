-- Busca de aluno com situação financeira em uma chamada.
--
-- Secretaria's most frequent question at the counter is "esse aluno está
-- em dia?", and answering it before this meant opening Financeiro,
-- finding the contrato by guessing the responsável, and reading the
-- parcela grid. This collapses it into one search box.
--
-- Plain SQL function (no `security definer`), like fn_relatorio_financeiro
-- (0015): it inherits the caller's RLS, so a responsável calling it sees
-- only their own children and a professor sees no financial figures —
-- no separate role check needed here. Also reachable as
-- /rest/v1/rpc/fn_buscar_alunos for external tooling.
--
-- unaccent so "jose"/"JOSÉ"/"josé" all match — mandatory for Brazilian
-- names, and the reason this is a function rather than a client-side
-- ilike: the browser cannot unaccent the *stored* side of the comparison.

-- `extensions` is Supabase's conventional home for contrib extensions and
-- already exists there; created here so the same migration also applies to
-- the bare postgres:16 used by the local harness and CI.
create schema if not exists extensions;
create extension if not exists unaccent with schema extensions;

-- The function is SECURITY INVOKER (so it inherits RLS), which means the
-- caller's own role resolves extensions.unaccent() and therefore needs
-- USAGE on the schema. Supabase already grants this; stated explicitly so
-- the bare postgres used locally and in CI behaves the same.
grant usage on schema extensions to authenticated, anon;

create or replace function fn_buscar_alunos(p_busca text default '')
returns table (
  aluno_id uuid,
  aluno_nome text,
  matricula_codigo text,
  aluno_status text,
  turma_nome text,
  unidade_nome text,
  unidade_cnpj text,
  responsavel_financeiro text,
  parcelas_abertas int,
  parcelas_atrasadas int,
  valor_aberto numeric,
  valor_atrasado numeric,
  competencia_mais_antiga_aberta date,
  proximo_vencimento date
)
language sql
stable
set search_path = public, extensions, pg_temp
as $$
  select
    a.id,
    pa.nome,
    a.matricula_codigo,
    a.status::text,
    t.nome,
    u.nome,
    u.cnpj,
    (
      select pr.nome
        from responsaveis_alunos ra
        join pessoas pr on pr.id = ra.responsavel_pessoa_id and pr.escola_id = ra.escola_id
       where ra.aluno_id = a.id and ra.escola_id = a.escola_id
         and ra.financeiro and ra.deleted_at is null
       order by pr.nome
       limit 1
    ),
    coalesce(f.abertas, 0)::int,
    coalesce(f.atrasadas, 0)::int,
    coalesce(f.valor_aberto, 0),
    coalesce(f.valor_atrasado, 0),
    f.mais_antiga,
    f.proximo_vencimento
  from alunos a
  join pessoas pa on pa.id = a.pessoa_id and pa.escola_id = a.escola_id
  left join matriculas m
    on m.aluno_id = a.id and m.escola_id = a.escola_id
   and m.status = 'ativa' and m.deleted_at is null
  left join turmas t on t.id = m.turma_id and t.escola_id = m.escola_id
  left join unidades u on u.id = t.unidade_id and u.escola_id = t.escola_id
  left join lateral (
    select
      count(*) filter (where p.status in ('pendente', 'atrasado'))::int as abertas,
      count(*) filter (where p.status = 'atrasado')::int as atrasadas,
      sum(p.valor_liquido) filter (where p.status in ('pendente', 'atrasado')) as valor_aberto,
      sum(p.valor_liquido) filter (where p.status = 'atrasado') as valor_atrasado,
      min(p.competencia) filter (where p.status in ('pendente', 'atrasado')) as mais_antiga,
      min(p.vencimento) filter (where p.status in ('pendente', 'atrasado')) as proximo_vencimento
    from parcelas p
    join contratos c on c.id = p.contrato_id and c.escola_id = p.escola_id
    where c.matricula_id = m.id and c.escola_id = m.escola_id
      and p.deleted_at is null and c.deleted_at is null
  ) f on true
  where a.deleted_at is null
    and (
      coalesce(p_busca, '') = ''
      or extensions.unaccent(pa.nome) ilike '%' || extensions.unaccent(p_busca) || '%'
      or a.matricula_codigo ilike '%' || p_busca || '%'
    )
  order by (coalesce(f.atrasadas, 0) > 0) desc, pa.nome;
$$;

revoke all on function fn_buscar_alunos(text) from public, anon;
grant execute on function fn_buscar_alunos(text) to authenticated;
