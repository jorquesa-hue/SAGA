-- Corrige três defeitos achados em auditoria (01/09/2026) no mesmo relatório,
-- porque são o mesmo bug de fundo: a função somava colunas de `parcelas`
-- depois de um `left join pagamentos`, e um join de 1-para-N sem agregação
-- prévia infla qualquer `sum` do lado "1" assim que existe mais de um
-- pagamento por parcela (comum: pagamento parcial, ou correção que gera um
-- segundo lançamento). Os `count(distinct p.id)` já escapavam do fan-out;
-- os `sum(p.valor_bruto/valor_desconto/valor_liquido)` não.
--
-- D1 (bruto/líquido duplicam com 2 pagamentos na mesma parcela) — corrigido
-- agregando os pagamentos por parcela num `left join lateral` antes de
-- somar, então cada parcela contribui exatamente uma vez para qualquer sum.
-- Reproduzido e confirmado corrigido: dividir um pagamento de R$980,00 em
-- dois de R$490,00 não move mais valor_bruto/valor_liquido do relatório.
--
-- D2 (qtd_atrasadas nunca sobe — nada no app escreve status='atrasado'
-- exceto o webhook do Asaas, que está stubbado) — corrigido derivando
-- pendente/atrasado por data de vencimento, exatamente como o painel
-- (dashboard/page.tsx) já faz, em vez de confiar no `status` gravado.
-- "Em aberto" continua sendo `status not in ('pago','cancelado','isento')`
-- — a mesma definição já usada pelo trigger de ordem de pagamento (0004,
-- fn_valida_ordem_pagamento) — só a separação pendente/atrasado dentro do
-- que está aberto passa a ser por data, não por status.
--
-- D5 (relatório não respondia "quanto está em aberto/vencido" — só
-- quantidades) — adiciona valor_em_aberto e valor_vencido ao retorno, para
-- não obrigar o cliente a buscar valor_liquido e subtrair valor_recebido
-- (que aliás sofria do mesmo fan-out antes desta correção).
-- CREATE OR REPLACE does not allow changing the output columns of a
-- RETURNS TABLE function (adding valor_em_aberto/valor_vencido below is
-- exactly that), so the old signature has to be dropped first.
drop function if exists fn_relatorio_financeiro(date, date);

create function fn_relatorio_financeiro(p_data_inicio date, p_data_fim date)
returns table (
  unidade_id uuid,
  unidade_nome text,
  unidade_cnpj text,
  competencia date,
  valor_bruto numeric,
  valor_desconto numeric,
  valor_liquido numeric,
  valor_recebido numeric,
  valor_em_aberto numeric,
  valor_vencido numeric,
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
    coalesce(sum(pg.recebido), 0) as valor_recebido,
    coalesce(
      sum(p.valor_liquido) filter (where p.status not in ('pago', 'cancelado', 'isento')),
      0
    ) as valor_em_aberto,
    coalesce(
      sum(p.valor_liquido) filter (
        where p.status not in ('pago', 'cancelado', 'isento') and p.vencimento < current_date
      ),
      0
    ) as valor_vencido,
    count(*)::int as qtd_parcelas,
    count(*) filter (
      where p.status not in ('pago', 'cancelado', 'isento') and p.vencimento >= current_date
    )::int as qtd_pendentes,
    count(*) filter (
      where p.status not in ('pago', 'cancelado', 'isento') and p.vencimento < current_date
    )::int as qtd_atrasadas
  from parcelas p
  join contratos c on c.id = p.contrato_id and c.escola_id = p.escola_id
  join matriculas m on m.id = c.matricula_id and m.escola_id = c.escola_id
  join turmas t on t.id = m.turma_id and t.escola_id = m.escola_id
  join unidades u on u.id = t.unidade_id and u.escola_id = t.escola_id
  left join lateral (
    select sum(pg.valor) as recebido
    from pagamentos pg
    where pg.parcela_id = p.id and pg.escola_id = p.escola_id and pg.deleted_at is null
  ) pg on true
  where p.competencia between p_data_inicio and p_data_fim
    and p.deleted_at is null
  group by u.id, u.nome, u.cnpj, p.competencia
  order by p.competencia, u.nome;
$$;

-- Grants unchanged from 0015 (same signature, CREATE OR REPLACE keeps them),
-- restated so this migration is self-contained if ever read on its own.
revoke all on function fn_relatorio_financeiro(date, date) from public;
grant execute on function fn_relatorio_financeiro(date, date) to authenticated;
