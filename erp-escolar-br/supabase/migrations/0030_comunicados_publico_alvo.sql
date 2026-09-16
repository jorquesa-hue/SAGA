-- Comunicados: o público-alvo passa a restringir de verdade, e "turma
-- específica" passa a guardar qual turma.
--
-- Dois defeitos conviviam aqui, e os dois aparecem no momento em que o
-- portal da família ganha uma aba de comunicados.
--
-- 1) comunicados_select era `escola_id = fn_jwt_escola_id()` e nada mais.
--    Qualquer responsável autenticado lia TODO comunicado da escola — o
--    que foi escrito para o corpo docente, e o rascunho ainda não enviado.
--    Filtrar na tela não resolve: pela arquitetura do próprio spec (§3.7)
--    a RLS é a única camada de autorização, e quem tem token pode fazer
--    GET /rest/v1/comunicados direto, sem passar por tela nenhuma.
--
-- 2) publico_alvo aceitava 'turma_especifica' sem que existisse coluna
--    para dizer QUAL turma. A opção estava no formulário, gravava, e o
--    comunicado não era de turma nenhuma — era, na prática, mais um
--    comunicado para todo mundo, com um rótulo que mentia.
--
-- enviado_em não nulo passa a ser a fronteira entre rascunho e publicado
-- para todo mundo que não é secretaria. Era um campo informativo; agora
-- decide visibilidade.

-- ── Qual turma ────────────────────────────────────────────────────────────

alter table comunicados add column turma_id uuid;

alter table comunicados add constraint comunicados_turma_fk
  foreign key (turma_id, escola_id) references turmas (id, escola_id);

-- O vínculo com turma existe exatamente quando o público é a turma. Sem
-- isto, 'turma_especifica' sem turma volta a ser comunicado geral
-- disfarçado, e turma preenchida em comunicado para 'todos' seria um
-- campo que ninguém lê.
alter table comunicados add constraint comunicados_turma_coerente
  check (
    (publico_alvo = 'turma_especifica' and turma_id is not null)
    or (publico_alvo <> 'turma_especifica' and turma_id is null)
  );

create index idx_comunicados_turma on comunicados (turma_id)
  where turma_id is not null;

comment on column comunicados.turma_id is
  'Turma destinatária quando publico_alvo = turma_especifica. Nula nos demais casos (comunicados_turma_coerente).';

-- ── A quais turmas a pessoa pertence ──────────────────────────────────────
--
-- SECURITY DEFINER de propósito, e a razão é sutil o bastante para merecer
-- estar escrita.
--
-- A primeira versão desta migração resolvia "é da turma?" com um EXISTS
-- sobre alunos/matriculas dentro da própria política. Subconsulta em
-- política roda como o CHAMADOR, então a RLS daquelas tabelas se aplica de
-- novo ali dentro — e o aluno não tem política de leitura em `alunos`. O
-- EXISTS dava falso, e o comunicado da própria turma simplesmente não
-- chegava nele. Sem erro, sem log: a regra falhava em silêncio, que é a
-- única forma de falha que ninguém percebe.
--
-- Concentrar a pergunta aqui troca esse acoplamento invisível por uma
-- resposta explícita, e faz a mesma pergunta valer igual para os três
-- papéis. Não vaza nada: devolve apenas as turmas do próprio chamador.
create or replace function fn_turmas_do_usuario()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  -- Professor: as turmas que leciona.
  select pt.turma_id
    from professores_turmas pt
   where pt.escola_id = fn_jwt_escola_id()
     and pt.professor_pessoa_id = fn_current_pessoa_id()
     and pt.deleted_at is null
  union
  -- Responsável: as turmas dos dependentes com matrícula ativa. Matrícula
  -- encerrada não conta — a família sai do mural da turma quando sai dela.
  select m.turma_id
    from responsaveis_alunos ra
    join matriculas m
      on m.aluno_id = ra.aluno_id and m.escola_id = ra.escola_id
   where ra.escola_id = fn_jwt_escola_id()
     and ra.responsavel_pessoa_id = fn_current_pessoa_id()
     and ra.deleted_at is null
     and m.status = 'ativa'
     and m.deleted_at is null
     and m.turma_id is not null
  union
  -- Aluno com conta própria (EJA, ensino médio).
  select m.turma_id
    from alunos al
    join matriculas m
      on m.aluno_id = al.id and m.escola_id = al.escola_id
   where al.escola_id = fn_jwt_escola_id()
     and al.pessoa_id = fn_current_pessoa_id()
     and al.deleted_at is null
     and m.status = 'ativa'
     and m.deleted_at is null
     and m.turma_id is not null
$$;

comment on function fn_turmas_do_usuario () is
  'Turmas às quais o chamador pertence, por qualquer vínculo (leciona, responde por aluno matriculado, ou é o aluno). SECURITY DEFINER: a política não pode depender da RLS das tabelas de vínculo.';

revoke all on function fn_turmas_do_usuario () from public, anon;
grant execute on function fn_turmas_do_usuario () to authenticated;

-- ── Quem lê o quê ─────────────────────────────────────────────────────────
--
-- Uma política só em vez de uma por papel: políticas múltiplas de SELECT se
-- combinam com OR, e é esse OR implícito que faz vazamento passar
-- despercebido em revisão. Aqui a regra inteira se lê de uma vez.
drop policy comunicados_select on comunicados;

create policy comunicados_select on comunicados
  for select to authenticated
  using (
    escola_id = fn_jwt_escola_id()
    and (
      -- Secretaria enxerga tudo, inclusive rascunho: é quem escreve.
      fn_jwt_role() in ('admin', 'secretaria')
      or (
        -- Lista fechada de papéis, de propósito: um papel novo criado no
        -- futuro não ganha acesso por omissão.
        fn_jwt_role() in ('responsavel', 'professor', 'aluno')
        -- enviado_em era campo informativo; agora é a fronteira entre
        -- rascunho e publicado para todo mundo que não é secretaria.
        and enviado_em is not null
        and (
          publico_alvo = 'todos'
          -- Aviso de inadimplência é conversa com quem paga: o aluno com
          -- conta própria não lê o que foi escrito para os responsáveis.
          or (publico_alvo = 'responsaveis' and fn_jwt_role() = 'responsavel')
          or (publico_alvo = 'professores' and fn_jwt_role() = 'professor')
          or (
            publico_alvo = 'turma_especifica'
            and turma_id in (select fn_turmas_do_usuario())
          )
        )
      )
    )
  );

-- ── Confirmação de leitura ────────────────────────────────────────────────
--
-- Para a escola, "avisamos a família" sem registro é a mesma coisa que não
-- ter avisado quando alguém contesta. Para a família, é o jeito de marcar
-- o que já resolveu e o que ainda não viu.
--
-- É um fato datado, não um estado editável: sem UPDATE e sem DELETE, igual
-- a consentimentos_lgpd. Desmarcar "eu li" não existe — não se desfaz ter
-- lido.
create table comunicados_leituras (
  id uuid primary key default gen_random_uuid(),
  escola_id uuid not null references escolas (id),
  comunicado_id uuid not null,
  pessoa_id uuid not null,
  lido_em timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint comunicados_leituras_id_escola_unique unique (id, escola_id),
  -- Uma pessoa confirma uma vez. Recarregar a tela não gera segunda linha.
  constraint comunicados_leituras_unica unique (comunicado_id, pessoa_id),
  constraint comunicados_leituras_comunicado_fk
    foreign key (comunicado_id, escola_id) references comunicados (id, escola_id),
  constraint comunicados_leituras_pessoa_fk
    foreign key (pessoa_id, escola_id) references pessoas (id, escola_id)
);

create index idx_comunicados_leituras_escola on comunicados_leituras (escola_id);
create index idx_comunicados_leituras_comunicado on comunicados_leituras (comunicado_id);

alter table comunicados_leituras enable row level security;

-- Só se confirma leitura em nome próprio, e só de comunicado que a pessoa
-- de fato pode ler. O EXISTS abaixo consulta comunicados como o próprio
-- chamador, então a política acima é reaplicada aqui: não dá para
-- registrar leitura de um comunicado que não se enxerga — o que seria uma
-- forma de descobrir que ele existe.
create policy comunicados_leituras_insert on comunicados_leituras
  for insert to authenticated
  with check (
    escola_id = fn_jwt_escola_id()
    and pessoa_id = fn_current_pessoa_id()
    and exists (
      select 1 from comunicados c
       where c.id = comunicados_leituras.comunicado_id
         and c.escola_id = comunicados_leituras.escola_id
         and c.deleted_at is null
    )
  );

create policy comunicados_leituras_select_staff on comunicados_leituras
  for select to authenticated
  using (escola_id = fn_jwt_escola_id() and fn_jwt_role() in ('admin', 'secretaria'));

create policy comunicados_leituras_select_self on comunicados_leituras
  for select to authenticated
  using (escola_id = fn_jwt_escola_id() and pessoa_id = fn_current_pessoa_id());

grant select, insert on comunicados_leituras to authenticated;

create trigger trg_log_acesso_comunicados_leituras
  after insert or update or delete on comunicados_leituras
  for each row execute function fn_log_acesso();
