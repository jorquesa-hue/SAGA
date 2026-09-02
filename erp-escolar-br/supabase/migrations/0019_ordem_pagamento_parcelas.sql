-- Regra de negócio: não é possível pagar uma parcela mais recente enquanto
-- existir parcela anterior do mesmo contrato em aberto.
--
-- Enforced by trigger, not only in the UI: the app talks to PostgREST
-- directly (spec §3.7 — no separate API layer), so any client holding a
-- valid token could POST /rest/v1/pagamentos and skip a form-level check.
-- The database is the only place this rule can actually hold.
--
-- "Em aberto" is deliberately defined by two conditions, not just status:
--   1. status not in ('pago','cancelado','isento'), and
--   2. no pagamento row referencing it.
-- Condition 2 matters because the app inserts the pagamento first and only
-- then flips parcelas.status to 'pago' (two statements, same session): a
-- status-only check would spuriously reject the *next* payment made before
-- that update lands, and would also reject a legitimate batch that settles
-- several competências in one transaction.
--
-- Note for whoever wires up Asaas: asaas-webhook inserts pagamentos too, so
-- a boleto paid out of order upstream would be rejected here rather than
-- silently recorded. That is the correct default (money received for a
-- parcela that should not have been payable is a reconciliation problem,
-- not a row to swallow quietly), but it means the webhook needs an explicit
-- reconciliation path — surface the error, do not discard the event.

create or replace function fn_valida_ordem_pagamento()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_parcela parcelas%rowtype;
  v_pendente_competencia date;
begin
  select * into v_parcela from parcelas where id = new.parcela_id;
  if not found then
    raise exception 'parcela % não encontrada', new.parcela_id;
  end if;

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

  return new;
end;
$$;

create trigger trg_pagamentos_ordem
  before insert on pagamentos
  for each row
  execute function fn_valida_ordem_pagamento();

-- Trigger-only: firing a trigger does not require the invoking role to hold
-- EXECUTE, so this closes the accidental RPC endpoint (same reasoning as
-- fn_log_acesso in 0009).
revoke execute on function fn_valida_ordem_pagamento() from public, anon, authenticated;
