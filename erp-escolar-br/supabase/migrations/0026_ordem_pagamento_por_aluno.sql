-- Estende a regra de ordem de pagamento para além do contrato.
--
-- 0019 impedia pagar uma competência mais recente com parcela anterior em
-- aberto NO MESMO CONTRATO. Isso deixava uma porta aberta que aparece
-- justamente no caso que mais importa: o aluno que deve. Um aluno com
-- contrato de 2025 em atraso e contrato de 2026 novo tinha o pagamento de
-- 2026 aceito normalmente — a escola registrava a mensalidade do ano
-- corrente e o débito antigo seguia esquecido, sem nada no sistema
-- sinalizando a contradição.
--
-- Agora são duas regras, nessa ordem:
--
--   1. (0019, inalterada) dentro do contrato, ordem de competência.
--   2. (nova) qualquer parcela VENCIDA e em aberto em OUTRO contrato do
--      mesmo aluno bloqueia o pagamento.
--
-- A regra 2 usa "vencida" (vencimento < hoje), não "competência anterior",
-- porque comparar competências entre contratos de anos diferentes não quer
-- dizer nada: o que caracteriza débito é ter vencido e não ter sido pago.
--
-- "Em aberto" continua com a definição de 0019 — status E ausência de
-- pagamento —, pelo mesmo motivo de lá: o app insere o pagamento e só
-- depois vira o status da parcela, então uma checagem só por status
-- rejeitaria o pagamento seguinte antes do update chegar.
--
-- Pagamentos de migração são isentos da regra 2, e isso é deliberado.
-- fn_importar_matriculas (0025) grava o que a escola REALMENTE recebeu
-- antes de usar o sistema. Uma escola que migra com aluno devendo 2024 e
-- contrato de 2025 quitado é o caso comum, não a exceção; aplicar a regra
-- ali faria a importação inteira falhar (ela é tudo-ou-nada) por causa de
-- um fato histórico que já aconteceu. A regra existe para impedir que a
-- secretaria receba FORA DE ORDEM daqui para frente, não para reescrever o
-- passado. A regra 1 continua valendo na importação — e é satisfeita
-- naturalmente, porque o backfill insere em ordem crescente de competência.

create or replace function fn_valida_ordem_pagamento()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_parcela parcelas%rowtype;
  v_aluno_id uuid;
  v_pendente_competencia date;
  v_vencida record;
begin
  select * into v_parcela from parcelas where id = new.parcela_id;
  if not found then
    raise exception 'parcela % não encontrada', new.parcela_id;
  end if;

  -- ── Regra 1: ordem de competência dentro do contrato ──────────────────
  select p.competencia
    into v_pendente_competencia
    from parcelas p
   where p.contrato_id = v_parcela.contrato_id
     and p.escola_id = v_parcela.escola_id
     and p.deleted_at is null
     and p.competencia < v_parcela.competencia
     and p.status not in ('pago', 'cancelado', 'isento')
     and not exists (
       select 1 from pagamentos g
        where g.parcela_id = p.id
          and g.deleted_at is null
     )
   order by p.competencia
   limit 1;

  if v_pendente_competencia is not null then
    raise exception
      'Existe parcela anterior em aberto (competência %). Quite as parcelas mais antigas antes de pagar a competência %.',
      to_char(v_pendente_competencia, 'MM/YYYY'),
      to_char(v_parcela.competencia, 'MM/YYYY')
      using errcode = 'check_violation';
  end if;

  -- ── Regra 2: débito vencido em outro contrato do mesmo aluno ──────────
  if new.meio <> 'migracao' then
    select m.aluno_id
      into v_aluno_id
      from contratos c
      join matriculas m on m.id = c.matricula_id and m.escola_id = c.escola_id
     where c.id = v_parcela.contrato_id
       and c.escola_id = v_parcela.escola_id;

    if v_aluno_id is not null then
      select p.competencia, p.vencimento, p.valor_liquido
        into v_vencida
        from parcelas p
        join contratos c on c.id = p.contrato_id and c.escola_id = p.escola_id
        join matriculas m on m.id = c.matricula_id and m.escola_id = c.escola_id
       where p.escola_id = v_parcela.escola_id
         and m.aluno_id = v_aluno_id
         and p.contrato_id <> v_parcela.contrato_id
         and p.deleted_at is null
         and c.deleted_at is null
         and m.deleted_at is null
         and p.vencimento < current_date
         and p.status not in ('pago', 'cancelado', 'isento')
         and not exists (
           select 1 from pagamentos g
            where g.parcela_id = p.id
              and g.deleted_at is null
         )
       order by p.vencimento
       limit 1;

      if found then
        raise exception
          'O aluno tem parcela vencida em outro contrato (competência %, vencida em %, R$ %). Quite o débito anterior antes de registrar este pagamento.',
          to_char(v_vencida.competencia, 'MM/YYYY'),
          to_char(v_vencida.vencimento, 'DD/MM/YYYY'),
          v_vencida.valor_liquido
          using errcode = 'check_violation';
      end if;
    end if;
  end if;

  return new;
end;
$$;

-- Trigger-only, como em 0019: disparar trigger não exige EXECUTE, então
-- isto fecha o endpoint RPC acidental.
revoke execute on function fn_valida_ordem_pagamento() from public, anon, authenticated;
