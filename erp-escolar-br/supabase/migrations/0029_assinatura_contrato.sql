-- Assinatura eletrônica do contrato de matrícula, pelo próprio responsável.
--
-- Até aqui quem "assinava" era a secretaria, clicando em Assinar no
-- Financeiro: o contrato ganhava assinado_em sem que nenhuma família
-- tivesse manifestado vontade. Isso serve como marco operacional para
-- gerar parcelas, mas não é assinatura de ninguém.
--
-- O que esta migração implementa é assinatura eletrônica SIMPLES, na
-- acepção da Lei 14.063/2020 e da MP 2.200-2/2001: entre particulares, o
-- que dá validade não é certificado ICP-Brasil, e sim a prova de autoria
-- e integridade. Então o que importa é o que fica registrado:
--
--   quem  — pessoa, com nome e CPF congelados no momento do aceite
--   quando — timestamp do servidor, não do relógio do cliente
--   de onde — IP e user-agent da requisição
--   o quê — o TEXTO INTEGRAL do contrato exibido, mais seu SHA-256
--
-- O último ponto é o que sustenta tudo. Guardar só "aceitou o contrato X"
-- não prova nada: o contrato pode ter mudado depois. Guardamos o texto
-- exato que a pessoa viu, e o hash dele. Se a escola alterar o valor da
-- anuidade amanhã, a assinatura continua apontando para o que foi aceito.
--
-- E o texto é renderizado NO SERVIDOR, por fn_contrato_texto, nunca
-- recebido do cliente. Se viesse do navegador, bastaria um POST forjado
-- para "assinar" um contrato com outro valor — a prova provaria a coisa
-- errada.
--
-- Limitação declarada: assinatura simples tem peso probatório menor que
-- ICP-Brasil se a família contestar em juízo. A escolha foi consciente
-- (ver README); o modelo aqui comporta um provedor externo depois sem
-- refazer nada, porque a tabela guarda o dossiê e não presume a origem.

-- ── Texto do contrato, determinístico ─────────────────────────────────────
--
-- SECURITY INVOKER de propósito: herda a RLS de contratos, então o
-- responsável só renderiza o contrato do próprio filho
-- (contratos_select_responsavel) e a secretaria só os da própria escola.
--
-- Nada de volátil entra no texto — nenhum current_date, nenhum "hoje".
-- Se o texto mudasse a cada chamada, o hash mudaria junto e a conferência
-- de integridade não significaria nada.
create or replace function fn_contrato_texto(p_contrato_id uuid)
returns text
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    'CONTRATO DE PRESTAÇÃO DE SERVIÇOS EDUCACIONAIS' || chr(10) || chr(10) ||
    'CONTRATADA: ' || coalesce(u.razao_social, '—') ||
      coalesce(' — CNPJ ' || u.cnpj, '') || chr(10) ||
    'ALUNO(A): ' || pe_aluno.nome || ' — matrícula ' || a.matricula_codigo || chr(10) ||
    'TURMA: ' || coalesce(t.nome, '—') || ' — ano letivo ' || al.ano || chr(10) ||
    chr(10) ||
    'CONDIÇÕES FINANCEIRAS' || chr(10) ||
    'Anuidade: R$ ' ||
      translate(to_char(c.valor_anuidade, 'FM999,999,990.00'), ',.', '.,') || chr(10) ||
    'Parcelas: ' || c.num_parcelas || 'x de R$ ' ||
      translate(to_char(round(c.valor_anuidade / c.num_parcelas, 2), 'FM999,999,990.00'), ',.', '.,') ||
      chr(10) ||
    'Vencimento: todo dia ' || c.vencimento_dia || chr(10) ||
    coalesce(
      chr(10) || 'DESCONTOS' || chr(10) || d.linhas || chr(10),
      ''
    ) ||
    chr(10) ||
    'As parcelas são quitadas da mais antiga para a mais recente. ' ||
    'A matrícula é renovada a cada ano letivo mediante novo contrato.' || chr(10) ||
    coalesce(chr(10) || 'Contrato na íntegra: ' || c.documento_url || chr(10), '')
  from contratos c
  join matriculas m on m.id = c.matricula_id and m.escola_id = c.escola_id
  join alunos a on a.id = m.aluno_id and a.escola_id = m.escola_id
  join pessoas pe_aluno on pe_aluno.id = a.pessoa_id and pe_aluno.escola_id = a.escola_id
  join anos_letivos al on al.id = m.ano_letivo_id and al.escola_id = m.escola_id
  left join turmas t on t.id = m.turma_id and t.escola_id = m.escola_id
  left join unidades u on u.id = t.unidade_id and u.escola_id = t.escola_id
  left join lateral (
    select string_agg(
             '- ' || dd.tipo::text ||
             coalesce(': ' || replace(to_char(dd.percentual, 'FM990.00'), '.', ',') || '%', '') ||
             coalesce(': R$ ' || translate(to_char(dd.valor, 'FM999,999,990.00'), ',.', '.,'), ''),
             chr(10) order by dd.tipo::text
           ) as linhas
      from descontos dd
     where dd.contrato_id = c.id
       and dd.escola_id = c.escola_id
       and dd.deleted_at is null
  ) d on true
  where c.id = p_contrato_id
    and c.deleted_at is null
$$;

comment on function fn_contrato_texto (uuid) is
  'Renderiza o texto do contrato de forma determinística, para exibição e para o hash da assinatura. SECURITY INVOKER: herda a RLS de contratos.';

revoke all on function fn_contrato_texto (uuid) from public, anon;
grant execute on function fn_contrato_texto (uuid) to authenticated;

-- ── Registro da assinatura ────────────────────────────────────────────────

create table contratos_assinaturas (
  id uuid primary key default gen_random_uuid(),
  escola_id uuid not null references escolas (id),
  contrato_id uuid not null,
  signatario_pessoa_id uuid not null,
  -- Nome e CPF são CÓPIA, não referência. Se a pessoa corrigir o nome
  -- daqui a dois anos, a assinatura tem de continuar dizendo quem assinou
  -- naquele dia — é isso que uma prova faz.
  signatario_nome text not null,
  signatario_cpf text,
  vinculo vinculo_responsavel,
  documento_texto text not null,
  documento_hash text not null check (documento_hash ~ '^[0-9a-f]{64}$'),
  ip inet not null,
  user_agent text,
  assinado_em timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint contratos_assinaturas_id_escola_unique unique (id, escola_id),
  -- Um contrato, uma assinatura. Reenvio do formulário não gera segunda.
  constraint contratos_assinaturas_contrato_unique unique (contrato_id),
  constraint contratos_assinaturas_contrato_fk
    foreign key (contrato_id, escola_id) references contratos (id, escola_id),
  constraint contratos_assinaturas_pessoa_fk
    foreign key (signatario_pessoa_id, escola_id) references pessoas (id, escola_id)
);

create index idx_contratos_assinaturas_escola on contratos_assinaturas (escola_id);
create index idx_contratos_assinaturas_contrato on contratos_assinaturas (contrato_id);

alter table contratos_assinaturas enable row level security;

create policy contratos_assinaturas_select_staff on contratos_assinaturas
  for select to authenticated
  using (escola_id = fn_jwt_escola_id() and fn_jwt_role() in ('admin', 'secretaria'));

-- Quem assinou pode reler a própria assinatura: é o comprovante dela.
create policy contratos_assinaturas_select_signatario on contratos_assinaturas
  for select to authenticated
  using (
    escola_id = fn_jwt_escola_id()
    and signatario_pessoa_id = fn_current_pessoa_id()
  );

-- Sem política de UPDATE e sem política de DELETE, deliberadamente. Uma
-- assinatura não se corrige: se estiver errada, o caminho é um distrato
-- registrado, não a edição da prova. Mesma postura de consentimentos_lgpd.
--
-- Também sem política de INSERT: a gravação passa pelo route handler
-- /api/assinar-contrato, porque o IP tem de vir da requisição e o
-- navegador não pode informá-lo honestamente — mesmo motivo de
-- consentimentos_lgpd.ip.
grant select on contratos_assinaturas to authenticated;

-- ── A assinatura é o que marca o contrato como assinado ───────────────────
--
-- SECURITY DEFINER porque o responsável não tem UPDATE em contratos (só
-- staff tem) — e é correto que não tenha. O que o autoriza a mover este
-- campo específico é justamente o ato de assinar, e é isso que o gatilho
-- expressa.
--
-- Só preenche quando está nulo: se a secretaria já havia marcado a data,
-- ela permanece. A data operacional e a data do aceite são fatos
-- diferentes, e a do aceite fica guardada aqui de qualquer forma.
create or replace function fn_marcar_contrato_assinado()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update contratos
     set assinado_em = new.assinado_em
   where id = new.contrato_id
     and escola_id = new.escola_id
     and assinado_em is null;
  return new;
end;
$$;

create trigger trg_contrato_assinado
  after insert on contratos_assinaturas
  for each row execute function fn_marcar_contrato_assinado();

revoke execute on function fn_marcar_contrato_assinado() from public, anon, authenticated;

-- Mesma trilha de acesso das demais tabelas de domínio (0007). A linha de
-- assinatura já é, em si, a prova do ato; o log serve para outra pergunta —
-- reconstruir em ordem cronológica, num lugar só, tudo que foi tocado.
create trigger trg_log_acesso_contratos_assinaturas
  after insert or update or delete on contratos_assinaturas
  for each row execute function fn_log_acesso();
