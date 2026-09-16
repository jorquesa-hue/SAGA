-- D3 da auditoria (01/09/2026): um aluno rematriculado em um novo ano
-- letivo aparecia duas vezes na busca. `fn_buscar_alunos` (0020) juntava
-- TODAS as matrículas com status='ativa', e como a unicidade é
-- (escola_id, aluno_id, ano_letivo_id), nada impede duas matrículas ativas
-- simultâneas — uma por ano letivo — sobretudo enquanto a matrícula do ano
-- anterior não é encerrada (a interface agora oferece essa transição, ver
-- MatriculasTab em apps/web/src/features/cadastros.tsx).
--
-- Corrigido escolhendo, por aluno, a matrícula ativa do ano letivo mais
-- recente (maior `anos_letivos.ano`) via LATERAL + LIMIT 1, em vez de um
-- JOIN comum que traz todas. Reproduzido e confirmado: matricular o mesmo
-- aluno em um segundo ano letivo não duplica mais a linha na busca.
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
  left join lateral (
    select m.id, m.turma_id
    from matriculas m
    join anos_letivos al on al.id = m.ano_letivo_id and al.escola_id = m.escola_id
    where m.aluno_id = a.id and m.escola_id = a.escola_id
      and m.status = 'ativa' and m.deleted_at is null
    order by al.ano desc
    limit 1
  ) m on true
  left join turmas t on t.id = m.turma_id and t.escola_id = a.escola_id
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
    where c.matricula_id = m.id and c.escola_id = a.escola_id
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
