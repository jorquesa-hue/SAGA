-- Core cadastros (spec §4). Every table carries escola_id and RLS is
-- enabled on all of them in 0008_rls_policies.sql — no exceptions (spec
-- §3.2). Nothing is ever hard-deleted: `deleted_at` plus RLS filtering only
-- (spec §4: "Nada de delete. Use deleted_at mais política de RLS que
-- filtra."). Composite (id, escola_id) unique constraints + composite
-- foreign keys enforce that a child row can never point at a parent row
-- belonging to a different escola, as defense-in-depth alongside RLS.

create table escolas (
  id uuid primary key default gen_random_uuid(),
  razao_social text not null,
  cnpj text not null,
  municipio_ibge char(7) not null check (municipio_ibge ~ '^[0-9]{7}$'),
  inep_codigo text check (inep_codigo is null or inep_codigo ~ '^[0-9]{8}$'),
  plano text not null default 'standard',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint escolas_cnpj_valido check (fn_cnpj_valido(cnpj)),
  constraint escolas_cnpj_unique unique (cnpj)
);
create trigger trg_escolas_updated_at before update on escolas
  for each row execute function fn_set_updated_at();

create table unidades (
  id uuid primary key default gen_random_uuid(),
  escola_id uuid not null references escolas (id),
  nome text not null,
  endereco jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create trigger trg_unidades_updated_at before update on unidades
  for each row execute function fn_set_updated_at();
create index idx_unidades_escola on unidades (escola_id);

create table anos_letivos (
  id uuid primary key default gen_random_uuid(),
  escola_id uuid not null references escolas (id),
  ano int not null check (ano between 2000 and 2100),
  data_inicio date not null,
  data_fim date not null,
  status ano_letivo_status not null default 'planejamento',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint anos_letivos_datas_check check (data_fim > data_inicio),
  constraint anos_letivos_escola_ano_unique unique (escola_id, ano),
  constraint anos_letivos_id_escola_unique unique (id, escola_id)
);
create trigger trg_anos_letivos_updated_at before update on anos_letivos
  for each row execute function fn_set_updated_at();
create index idx_anos_letivos_escola on anos_letivos (escola_id);

create table cursos (
  id uuid primary key default gen_random_uuid(),
  escola_id uuid not null references escolas (id),
  nome text not null,
  etapa_ensino etapa_ensino not null,
  modalidade modalidade_curso not null default 'presencial',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint cursos_id_escola_unique unique (id, escola_id)
);
create trigger trg_cursos_updated_at before update on cursos
  for each row execute function fn_set_updated_at();
create index idx_cursos_escola on cursos (escola_id);

create table turmas (
  id uuid primary key default gen_random_uuid(),
  escola_id uuid not null references escolas (id),
  ano_letivo_id uuid not null,
  curso_id uuid not null,
  nome text not null,
  turno turno not null,
  capacidade int not null check (capacidade > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint turmas_id_escola_unique unique (id, escola_id),
  constraint turmas_ano_letivo_fk foreign key (ano_letivo_id, escola_id)
    references anos_letivos (id, escola_id),
  constraint turmas_curso_fk foreign key (curso_id, escola_id)
    references cursos (id, escola_id)
);
create trigger trg_turmas_updated_at before update on turmas
  for each row execute function fn_set_updated_at();
create index idx_turmas_escola on turmas (escola_id);
create index idx_turmas_ano_letivo on turmas (ano_letivo_id);
create index idx_turmas_curso on turmas (curso_id);

-- pessoas is the single identity entity (spec §4: "pessoas é a entidade
-- única. Um adulto pode ser responsável e professor ao mesmo tempo").
-- auth_user_id links to Supabase auth.users once the person has portal
-- access (Milestone 2); null for people who never log in (e.g. most
-- alunos).
create table pessoas (
  id uuid primary key default gen_random_uuid(),
  escola_id uuid not null references escolas (id),
  nome text not null,
  cpf text check (cpf is null or fn_cpf_valido(cpf)),
  data_nascimento date not null,
  papeis pessoa_papel[] not null default '{}',
  auth_user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint pessoas_id_escola_unique unique (id, escola_id)
);
create trigger trg_pessoas_updated_at before update on pessoas
  for each row execute function fn_set_updated_at();
create index idx_pessoas_escola on pessoas (escola_id);
create unique index uq_pessoas_escola_cpf on pessoas (escola_id, cpf)
  where cpf is not null and deleted_at is null;
create unique index uq_pessoas_auth_user on pessoas (auth_user_id)
  where auth_user_id is not null;

create table alunos (
  id uuid primary key default gen_random_uuid(),
  escola_id uuid not null references escolas (id),
  pessoa_id uuid not null,
  matricula_codigo text not null,
  status text not null default 'ativo'
    check (status in ('ativo', 'inativo', 'transferido', 'egresso')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint alunos_id_escola_unique unique (id, escola_id),
  constraint alunos_escola_matricula_codigo_unique unique (escola_id, matricula_codigo),
  constraint alunos_pessoa_fk foreign key (pessoa_id, escola_id)
    references pessoas (id, escola_id)
);
create trigger trg_alunos_updated_at before update on alunos
  for each row execute function fn_set_updated_at();
create index idx_alunos_escola on alunos (escola_id);
create index idx_alunos_pessoa on alunos (pessoa_id);

create table responsaveis_alunos (
  id uuid primary key default gen_random_uuid(),
  escola_id uuid not null references escolas (id),
  responsavel_pessoa_id uuid not null,
  aluno_id uuid not null,
  vinculo vinculo_responsavel not null,
  financeiro boolean not null default false,
  pedagogico boolean not null default false,
  retirada boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint responsaveis_alunos_id_escola_unique unique (id, escola_id),
  constraint responsaveis_alunos_unique unique (escola_id, responsavel_pessoa_id, aluno_id),
  constraint responsaveis_alunos_pessoa_fk foreign key (responsavel_pessoa_id, escola_id)
    references pessoas (id, escola_id),
  constraint responsaveis_alunos_aluno_fk foreign key (aluno_id, escola_id)
    references alunos (id, escola_id)
);
create trigger trg_responsaveis_alunos_updated_at before update on responsaveis_alunos
  for each row execute function fn_set_updated_at();
create index idx_responsaveis_alunos_escola on responsaveis_alunos (escola_id);
create index idx_responsaveis_alunos_responsavel on responsaveis_alunos (responsavel_pessoa_id);
create index idx_responsaveis_alunos_aluno on responsaveis_alunos (aluno_id);

-- professores_turmas is NOT in erp-escolar-br-arquitetura.md §4's table
-- list. Added because spec §3.6 ("Professor só enxerga as turmas
-- atribuídas a ele") is a non-negotiable RLS rule with no other table to
-- anchor it on. Flagged for review — see README "Desvios da especificação".
create table professores_turmas (
  id uuid primary key default gen_random_uuid(),
  escola_id uuid not null references escolas (id),
  professor_pessoa_id uuid not null,
  turma_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint professores_turmas_id_escola_unique unique (id, escola_id),
  constraint professores_turmas_unique unique (escola_id, professor_pessoa_id, turma_id),
  constraint professores_turmas_pessoa_fk foreign key (professor_pessoa_id, escola_id)
    references pessoas (id, escola_id),
  constraint professores_turmas_turma_fk foreign key (turma_id, escola_id)
    references turmas (id, escola_id)
);
create trigger trg_professores_turmas_updated_at before update on professores_turmas
  for each row execute function fn_set_updated_at();
create index idx_professores_turmas_escola on professores_turmas (escola_id);
create index idx_professores_turmas_professor on professores_turmas (professor_pessoa_id);
create index idx_professores_turmas_turma on professores_turmas (turma_id);

create table matriculas (
  id uuid primary key default gen_random_uuid(),
  escola_id uuid not null references escolas (id),
  aluno_id uuid not null,
  turma_id uuid not null,
  ano_letivo_id uuid not null,
  data date not null,
  status matricula_status not null default 'pre',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint matriculas_id_escola_unique unique (id, escola_id),
  constraint matriculas_escola_aluno_ano_unique unique (escola_id, aluno_id, ano_letivo_id),
  constraint matriculas_aluno_fk foreign key (aluno_id, escola_id)
    references alunos (id, escola_id),
  constraint matriculas_turma_fk foreign key (turma_id, escola_id)
    references turmas (id, escola_id),
  constraint matriculas_ano_letivo_fk foreign key (ano_letivo_id, escola_id)
    references anos_letivos (id, escola_id)
);
create trigger trg_matriculas_updated_at before update on matriculas
  for each row execute function fn_set_updated_at();
create index idx_matriculas_escola on matriculas (escola_id);
create index idx_matriculas_aluno on matriculas (aluno_id);
create index idx_matriculas_turma on matriculas (turma_id);

-- Resolves the calling user's own pessoas.id from auth.uid(), for use
-- inside RLS policies (professor/responsavel scoping). SECURITY DEFINER +
-- fixed search_path so it can safely bypass RLS to read the caller's own
-- row without provoking recursive policy evaluation on `pessoas` — this is
-- Supabase's documented pattern for identity lookups used inside policies.
-- It only ever returns the caller's own id (scoped by auth.uid() and the
-- caller's own escola_id claim), so bypassing RLS here does not leak
-- cross-tenant or cross-person data.
create or replace function fn_current_pessoa_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from pessoas
  where auth_user_id = auth.uid()
    and escola_id = fn_jwt_escola_id()
  limit 1
$$;

revoke all on function fn_current_pessoa_id () from public;
grant execute on function fn_current_pessoa_id () to authenticated;
