-- contratos.vencimento_dia is constrained to 1..28 (0005_financeiro_tables.sql),
-- which is <= every month's last day including February — the month-end
-- clamping in 0012's fn_gerar_parcelas was dead code. Simplify.
create or replace function fn_gerar_parcelas(p_contrato_id uuid)
returns setof parcelas
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_contrato contratos%rowtype;
  v_desconto_pct numeric(5, 2);
  v_desconto_valor numeric(12, 2);
  v_valor_bruto numeric(12, 2);
  v_valor_desconto numeric(12, 2);
  v_valor_liquido numeric(12, 2);
  v_competencia date;
  v_vencimento date;
  i int;
begin
  select * into v_contrato from contratos where id = p_contrato_id;
  if not found then
    raise exception 'contrato % não encontrado', p_contrato_id;
  end if;

  if v_contrato.assinado_em is null then
    raise exception 'contrato % ainda não foi assinado', p_contrato_id;
  end if;

  if exists (select 1 from parcelas where contrato_id = p_contrato_id) then
    raise exception 'parcelas já geradas para o contrato %', p_contrato_id;
  end if;

  select coalesce(sum(percentual), 0), coalesce(sum(valor), 0)
    into v_desconto_pct, v_desconto_valor
    from descontos
    where contrato_id = p_contrato_id
      and deleted_at is null
      and v_contrato.assinado_em::date <@ vigencia;

  v_valor_bruto := round(v_contrato.valor_anuidade / v_contrato.num_parcelas, 2);

  for i in 1..v_contrato.num_parcelas loop
    v_competencia := (date_trunc('month', v_contrato.assinado_em::date) + ((i - 1) || ' months')::interval)::date;
    v_vencimento := make_date(
      extract(year from v_competencia)::int,
      extract(month from v_competencia)::int,
      v_contrato.vencimento_dia
    );

    v_valor_desconto := round(v_valor_bruto * (v_desconto_pct / 100), 2)
      + round(v_desconto_valor / v_contrato.num_parcelas, 2);
    if v_valor_desconto > v_valor_bruto then
      v_valor_desconto := v_valor_bruto;
    end if;
    v_valor_liquido := v_valor_bruto - v_valor_desconto;

    insert into parcelas (escola_id, contrato_id, competencia, vencimento, valor_bruto, valor_desconto, valor_liquido, status)
    values (v_contrato.escola_id, p_contrato_id, v_competencia, v_vencimento, v_valor_bruto, v_valor_desconto, v_valor_liquido, 'pendente');
  end loop;

  return query select * from parcelas where contrato_id = p_contrato_id order by competencia;
end;
$$;
