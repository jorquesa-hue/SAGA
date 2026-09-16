-- Writes every relevant INSERT/UPDATE/DELETE into logs_acesso via trigger,
-- not via application code (spec §4). SECURITY DEFINER so the function
-- owner's privileges (not the caller's) are used to insert into
-- logs_acesso — application roles never get a direct INSERT grant on it
-- (see 0008_rls_policies.sql), so this is the only write path.
create or replace function fn_log_acesso()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_escola_id uuid;
  v_entidade_id uuid;
begin
  if tg_op = 'DELETE' then
    v_entidade_id := old.id;
  else
    v_entidade_id := new.id;
  end if;

  -- escolas is the tenant root: it has no escola_id column, its own id IS
  -- the tenant id. Every other audited table carries escola_id.
  if tg_table_name = 'escolas' then
    v_escola_id := v_entidade_id;
  elsif tg_op = 'DELETE' then
    v_escola_id := old.escola_id;
  else
    v_escola_id := new.escola_id;
  end if;

  insert into logs_acesso (escola_id, ator_id, entidade, entidade_id, acao)
  values (v_escola_id, fn_current_pessoa_id(), tg_table_name, v_entidade_id, lower(tg_op)::acao_log);

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'escolas', 'unidades', 'anos_letivos', 'cursos', 'turmas', 'pessoas', 'alunos',
    'responsaveis_alunos', 'professores_turmas', 'matriculas', 'contratos',
    'descontos', 'parcelas', 'pagamentos', 'notas_fiscais', 'comunicados',
    'consentimentos_lgpd'
  ]
  loop
    execute format(
      'create trigger trg_log_acesso_%1$s after insert or update or delete on %1$s
       for each row execute function fn_log_acesso();',
      t
    );
  end loop;
end
$$;
