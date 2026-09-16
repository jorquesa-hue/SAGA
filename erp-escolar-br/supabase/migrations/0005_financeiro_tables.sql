-- Financeiro (spec §4). Parcelas are generated at contract signature, not
-- on demand: "Parcela é gerada na assinatura do contrato, não sob demanda.
-- Estado financeiro precisa ser auditável ponta a ponta." The parcela
-- generation logic itself belongs to Milestone 4 (Contratos e parcelas);
-- this migration only lays down the schema + RLS it will write into.
-- Monetary values are numeric(12,2), never float (spec §6).

create table contratos (
  id uuid primary key default gen_random_uuid(),
  escola_id uuid not null references escolas (id),
  matricula_id uuid not null,
  valor_anuidade numeric(12, 2) not null check (valor_anuidade > 0),
  num_parcelas int not null check (num_parcelas between 1 and 12),
  vencimento_dia int not null check (vencimento_dia between 1 and 28),
  assinado_em timestamptz,
  documento_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint contratos_id_escola_unique unique (id, escola_id),
  constraint contratos_matricula_fk foreign key (matricula_id, escola_id)
    references matriculas (id, escola_id)
);
create trigger trg_contratos_updated_at before update on contratos
  for each row execute function fn_set_updated_at();
create index idx_contratos_escola on contratos (escola_id);
create index idx_contratos_matricula on contratos (matricula_id);

create table descontos (
  id uuid primary key default gen_random_uuid(),
  escola_id uuid not null references escolas (id),
  contrato_id uuid not null,
  tipo desconto_tipo not null,
  percentual numeric(5, 2) check (percentual is null or percentual between 0 and 100),
  valor numeric(12, 2) check (valor is null or valor >= 0),
  vigencia daterange not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint descontos_id_escola_unique unique (id, escola_id),
  constraint descontos_contrato_fk foreign key (contrato_id, escola_id)
    references contratos (id, escola_id),
  constraint descontos_percentual_ou_valor check (percentual is not null or valor is not null)
);
create trigger trg_descontos_updated_at before update on descontos
  for each row execute function fn_set_updated_at();
create index idx_descontos_escola on descontos (escola_id);
create index idx_descontos_contrato on descontos (contrato_id);

create table parcelas (
  id uuid primary key default gen_random_uuid(),
  escola_id uuid not null references escolas (id),
  contrato_id uuid not null,
  competencia date not null,
  vencimento date not null,
  valor_bruto numeric(12, 2) not null check (valor_bruto >= 0),
  valor_desconto numeric(12, 2) not null default 0 check (valor_desconto >= 0),
  valor_liquido numeric(12, 2) not null check (valor_liquido >= 0),
  status parcela_status not null default 'pendente',
  asaas_cobranca_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint parcelas_id_escola_unique unique (id, escola_id),
  constraint parcelas_contrato_fk foreign key (contrato_id, escola_id)
    references contratos (id, escola_id),
  constraint parcelas_escola_contrato_competencia_unique unique (escola_id, contrato_id, competencia),
  constraint parcelas_valor_liquido_consistente_check check (valor_liquido = valor_bruto - valor_desconto)
);
create trigger trg_parcelas_updated_at before update on parcelas
  for each row execute function fn_set_updated_at();
create index idx_parcelas_escola on parcelas (escola_id);
create index idx_parcelas_contrato on parcelas (contrato_id);

create table pagamentos (
  id uuid primary key default gen_random_uuid(),
  escola_id uuid not null references escolas (id),
  parcela_id uuid not null,
  valor numeric(12, 2) not null check (valor > 0),
  data date not null,
  meio meio_pagamento not null,
  asaas_pagamento_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint pagamentos_id_escola_unique unique (id, escola_id),
  constraint pagamentos_parcela_fk foreign key (parcela_id, escola_id)
    references parcelas (id, escola_id)
);
create trigger trg_pagamentos_updated_at before update on pagamentos
  for each row execute function fn_set_updated_at();
create index idx_pagamentos_escola on pagamentos (escola_id);
create index idx_pagamentos_parcela on pagamentos (parcela_id);

create table notas_fiscais (
  id uuid primary key default gen_random_uuid(),
  escola_id uuid not null references escolas (id),
  pagamento_id uuid not null,
  numero text,
  status nota_fiscal_status not null default 'pendente',
  xml_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint notas_fiscais_id_escola_unique unique (id, escola_id),
  constraint notas_fiscais_pagamento_fk foreign key (pagamento_id, escola_id)
    references pagamentos (id, escola_id)
);
create trigger trg_notas_fiscais_updated_at before update on notas_fiscais
  for each row execute function fn_set_updated_at();
create index idx_notas_fiscais_escola on notas_fiscais (escola_id);
create index idx_notas_fiscais_pagamento on notas_fiscais (pagamento_id);
