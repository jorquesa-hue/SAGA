-- Outbox transacional de e-mail, e o gatilho que enfileira a nota fiscal
-- emitida.
--
-- Por que outbox e não "a Edge Function manda na hora": mandar e-mail é
-- uma chamada de rede a um terceiro, e ela falha — provedor fora do ar,
-- rate limit, domínio ainda não verificado. Se o envio fosse feito dentro
-- do fluxo que emite a nota, uma falha de e-mail ou derrubaria a emissão
-- (péssimo: a nota é o documento fiscal, o e-mail é conveniência) ou seria
-- engolida em silêncio (pior ainda: a família não recebe e ninguém fica
-- sabendo). Com outbox, a intenção de enviar é gravada na MESMA transação
-- que emite a nota, e o envio vira trabalho separado que pode ser
-- retentado e auditado. É o mesmo padrão que o CLAUDE.md já exige para
-- eventos de domínio no SAGA.
--
-- O gatilho dispara quando notas_fiscais chega em 'emitida' — por
-- emitir-nota-fiscal (provedor síncrono) ou por nfe-webhook (assíncrono,
-- que é o caso comum). Nenhuma das duas funções precisou mudar.
--
-- ATENÇÃO, e isto precisa estar escrito: enquanto não existir provedor de
-- eNF configurado, a nota fiscal nunca sai de 'pendente'. Logo este
-- gatilho nunca dispara e nenhum e-mail é enfileirado. O caminho está
-- pronto e testável, mas o envio de recibo por e-mail depende de DUAS
-- contas externas — o provedor de NFS-e e o Resend —, não só do Resend.

create table emails_transacionais (
  id uuid primary key default gen_random_uuid(),
  escola_id uuid not null references escolas (id),
  tipo text not null check (tipo in ('nota_fiscal')),
  nota_fiscal_id uuid,
  destinatario_pessoa_id uuid,
  -- Nulo quando não achamos endereço. A linha é gravada mesmo assim: a
  -- escola precisa ENXERGAR que quis mandar e não tinha para onde, em vez
  -- de o recibo sumir sem rastro.
  destinatario_email text,
  assunto text not null,
  corpo text not null,
  status text not null default 'pendente'
    check (status in ('pendente', 'enviado', 'erro', 'sem_destinatario')),
  provedor text,
  referencia_externa text,
  erro_detalhe text,
  tentativas int not null default 0 check (tentativas >= 0),
  enviado_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint emails_transacionais_id_escola_unique unique (id, escola_id),
  constraint emails_transacionais_nota_fiscal_fk
    foreign key (nota_fiscal_id, escola_id) references notas_fiscais (id, escola_id),
  constraint emails_transacionais_pessoa_fk
    foreign key (destinatario_pessoa_id, escola_id) references pessoas (id, escola_id)
);

create trigger trg_emails_transacionais_updated_at before update on emails_transacionais
  for each row execute function fn_set_updated_at();

create index idx_emails_transacionais_escola on emails_transacionais (escola_id);
create index idx_emails_transacionais_pendentes on emails_transacionais (status, created_at)
  where status = 'pendente';

-- Uma nota fiscal gera um e-mail, e só um. A entrega do webhook é
-- at-least-once (o provedor reenvia), então sem isto uma reentrega
-- mandaria o mesmo recibo de novo para a família.
create unique index uq_emails_transacionais_nota_fiscal
  on emails_transacionais (nota_fiscal_id)
  where nota_fiscal_id is not null;

alter table emails_transacionais enable row level security;

-- Staff lê para conferir o que saiu e o que falhou. Ninguém escreve pela
-- API: quem grava é o gatilho abaixo (definer) e a Edge Function de envio
-- (service_role). Mesmo desenho de logs_acesso.
create policy emails_transacionais_select_staff on emails_transacionais
  for select to authenticated
  using (escola_id = fn_jwt_escola_id() and fn_jwt_role() in ('admin', 'secretaria'));

grant select on emails_transacionais to authenticated;

-- ── Gatilho: nota fiscal emitida → e-mail enfileirado ─────────────────────

create or replace function fn_enfileirar_email_nota_fiscal()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v record;
  v_email text;
  v_pessoa_id uuid;
  v_corpo text;
begin
  if new.status <> 'emitida' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status = 'emitida' then
    return new;
  end if;

  -- Contexto do pagamento: quem pagou o quê, de qual unidade (é o CNPJ da
  -- unidade que emite a nota, não o da escola — ver 0014).
  select pg.valor, pg.data, pg.meio::text as meio,
         pa.competencia, pa.vencimento,
         pe_aluno.nome as aluno_nome, pe_aluno.id as aluno_pessoa_id,
         pe_aluno.email as aluno_email,
         u.razao_social, u.cnpj
    into v
    from pagamentos pg
    join parcelas pa on pa.id = pg.parcela_id and pa.escola_id = pg.escola_id
    join contratos c on c.id = pa.contrato_id and c.escola_id = pa.escola_id
    join matriculas m on m.id = c.matricula_id and m.escola_id = c.escola_id
    join alunos a on a.id = m.aluno_id and a.escola_id = m.escola_id
    join pessoas pe_aluno on pe_aluno.id = a.pessoa_id and pe_aluno.escola_id = a.escola_id
    left join turmas t on t.id = m.turma_id and t.escola_id = m.escola_id
    left join unidades u on u.id = t.unidade_id and u.escola_id = t.escola_id
   where pg.id = new.pagamento_id
     and pg.escola_id = new.escola_id;

  if not found then
    return new;
  end if;

  -- Destinatário: o responsável financeiro do aluno. Se ele não tem
  -- e-mail, cai para o e-mail do próprio aluno (aluno adulto, EJA), e se
  -- nem isso existir a linha fica 'sem_destinatario'.
  select ra.responsavel_pessoa_id, pe.email
    into v_pessoa_id, v_email
    from responsaveis_alunos ra
    join pessoas pe on pe.id = ra.responsavel_pessoa_id and pe.escola_id = ra.escola_id
    join alunos a on a.id = ra.aluno_id and a.escola_id = ra.escola_id
    join matriculas m on m.aluno_id = a.id and m.escola_id = a.escola_id
    join contratos c on c.matricula_id = m.id and c.escola_id = m.escola_id
    join parcelas pa on pa.contrato_id = c.id and pa.escola_id = c.escola_id
    join pagamentos pg on pg.parcela_id = pa.id and pg.escola_id = pa.escola_id
   where pg.id = new.pagamento_id
     and ra.escola_id = new.escola_id
     and ra.financeiro = true
     and ra.deleted_at is null
     and pe.deleted_at is null
     and pe.email is not null
   limit 1;

  if v_email is null then
    v_pessoa_id := v.aluno_pessoa_id;
    v_email := v.aluno_email;
  end if;

  v_corpo :=
    'Olá,' || chr(10) || chr(10) ||
    'Segue a nota fiscal referente ao pagamento abaixo.' || chr(10) || chr(10) ||
    'Aluno(a): ' || v.aluno_nome || chr(10) ||
    'Competência: ' || to_char(v.competencia, 'MM/YYYY') || chr(10) ||
    'Vencimento: ' || to_char(v.vencimento, 'DD/MM/YYYY') || chr(10) ||
    -- Vírgula decimal: o documento vai para a família, não para um log.
    'Valor pago: R$ ' || replace(to_char(v.valor, 'FM9999999990.00'), '.', ',') || chr(10) ||
    'Data do pagamento: ' || to_char(v.data, 'DD/MM/YYYY') || chr(10) ||
    'Forma de pagamento: ' || v.meio || chr(10) ||
    coalesce('Nota fiscal nº ' || new.numero || chr(10), '') ||
    coalesce('XML: ' || new.xml_url || chr(10), '') ||
    chr(10) ||
    coalesce(v.razao_social, '') ||
    coalesce(' — CNPJ ' || v.cnpj, '') || chr(10);

  insert into emails_transacionais (
    escola_id, tipo, nota_fiscal_id, destinatario_pessoa_id, destinatario_email,
    assunto, corpo, status
  )
  values (
    new.escola_id, 'nota_fiscal', new.id, v_pessoa_id, v_email,
    'Nota fiscal — ' || v.aluno_nome || ' — ' || to_char(v.competencia, 'MM/YYYY'),
    v_corpo,
    case when v_email is null then 'sem_destinatario' else 'pendente' end
  )
  on conflict (nota_fiscal_id) where nota_fiscal_id is not null do nothing;

  return new;
end;
$$;

create trigger trg_emails_nota_fiscal
  after insert or update of status on notas_fiscais
  for each row execute function fn_enfileirar_email_nota_fiscal();

revoke execute on function fn_enfileirar_email_nota_fiscal() from public, anon, authenticated;
