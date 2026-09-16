-- Financial reporting module (user request: "a very robust financial
-- reporting module"). A single aggregating RPC rather than N ad-hoc
-- queries from the client — one round trip, grouped by unidade (CNPJ)
-- and competência, covering the whole receita/desconto/recebido/
-- inadimplência picture in one call. Kept as a plain SQL function (NOT
-- security definer) so RLS on parcelas/contratos/matriculas/turmas/
-- unidades/pagamentos applies exactly as it would to hand-written
-- queries: a staff caller sees their own escola's numbers, anyone else
-- gets an empty/filtered result — no separate role check needed inside
-- the function, the same tenant-isolation the rest of the app relies on
-- already does the work.
--
-- Also deliberately callable via the Supabase REST/RPC API by an
-- external BI/reporting tool with a staff-scoped API key, not only from
-- apps/web — this is the "integration friendly" half of the same ask.
create or replace function fn_relatorio_financeiro(p_data_inicio date, p_data_fim date)
returns table (
  unidade_id uuid,
  unidade_nome text,
  unidade_cnpj text,
  competencia date,
  valor_bruto numeric,
  valor_desconto numeric,
  valor_liquido numeric,
  valor_recebido numeric,
  qtd_parcelas int,
  qtd_pendentes int,
  qtd_atrasadas int
)
language sql
stable
as $$
  select
    u.id as unidade_id,
    u.nome as unidade_nome,
    u.cnpj as unidade_cnpj,
    p.competencia,
    sum(p.valor_bruto) as valor_bruto,
    sum(p.valor_desconto) as valor_desconto,
    sum(p.valor_liquido) as valor_liquido,
    coalesce(sum(pg.valor), 0) as valor_recebido,
    count(distinct p.id)::int as qtd_parcelas,
    count(distinct p.id) filter (where p.status = 'pendente')::int as qtd_pendentes,
    count(distinct p.id) filter (where p.status = 'atrasado')::int as qtd_atrasadas
  from parcelas p
  join contratos c on c.id = p.contrato_id and c.escola_id = p.escola_id
  join matriculas m on m.id = c.matricula_id and m.escola_id = c.escola_id
  join turmas t on t.id = m.turma_id and t.escola_id = m.escola_id
  join unidades u on u.id = t.unidade_id and u.escola_id = t.escola_id
  left join pagamentos pg on pg.parcela_id = p.id and pg.escola_id = p.escola_id
    and pg.deleted_at is null
  where p.competencia between p_data_inicio and p_data_fim
    and p.deleted_at is null
  group by u.id, u.nome, u.cnpj, p.competencia
  order by p.competencia, u.nome;
$$;

revoke all on function fn_relatorio_financeiro(date, date) from public;
grant execute on function fn_relatorio_financeiro(date, date) to authenticated;
