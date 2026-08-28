create table comunicados (
  id uuid primary key default gen_random_uuid(),
  escola_id uuid not null references escolas (id),
  titulo text not null,
  corpo text not null,
  publico_alvo publico_alvo not null,
  enviado_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint comunicados_id_escola_unique unique (id, escola_id)
);
create trigger trg_comunicados_updated_at before update on comunicados
  for each row execute function fn_set_updated_at();
create index idx_comunicados_escola on comunicados (escola_id);

-- consentimentos_lgpd is guarda permanente / append-only (spec §1: base
-- legal é o melhor interesse da criança; consentimento precisa de
-- timestamp e finalidade registrados). No update or delete policy is ever
-- created for it (0008_rls_policies.sql) — rows are immutable once
-- inserted.
create table consentimentos_lgpd (
  id uuid primary key default gen_random_uuid(),
  escola_id uuid not null references escolas (id),
  titular_pessoa_id uuid not null,
  responsavel_pessoa_id uuid,
  finalidade text not null,
  versao_termo text not null,
  aceito_em timestamptz not null default now(),
  ip inet not null,
  created_at timestamptz not null default now(),
  constraint consentimentos_lgpd_titular_fk foreign key (titular_pessoa_id, escola_id)
    references pessoas (id, escola_id),
  constraint consentimentos_lgpd_responsavel_fk foreign key (responsavel_pessoa_id, escola_id)
    references pessoas (id, escola_id)
);
create index idx_consentimentos_lgpd_escola on consentimentos_lgpd (escola_id);
create index idx_consentimentos_lgpd_titular on consentimentos_lgpd (titular_pessoa_id);

-- logs_acesso is append-only and written exclusively by the SECURITY
-- DEFINER trigger in 0007_audit_trigger.sql (spec §4: "Toda escrita
-- relevante grava em logs_acesso via trigger, não via código de
-- aplicação"). No application role is ever granted INSERT/UPDATE/DELETE on
-- it directly (0008_rls_policies.sql grants SELECT only, to admins).
create table logs_acesso (
  id uuid primary key default gen_random_uuid(),
  escola_id uuid not null references escolas (id),
  ator_id uuid,
  entidade text not null,
  entidade_id uuid not null,
  acao acao_log not null,
  em timestamptz not null default now()
);
create index idx_logs_acesso_escola on logs_acesso (escola_id);
create index idx_logs_acesso_entidade on logs_acesso (entidade, entidade_id);
