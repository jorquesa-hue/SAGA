-- Move fiscal identity (CNPJ, razão social, inscrição municipal,
-- município IBGE, código INEP) from the tenant (escolas) down to the
-- legal entity (unidades). A Brazilian school network commonly operates
-- each physical campus under its own CNPJ — sometimes in different
-- municípios — for NFS-e issuance and tax purposes. escolas remains the
-- tenant/account boundary (the login/subscription); unidades is now
-- where invoicing resolves which CNPJ/prestador issued a nota fiscal.
--
-- Session start had zero rows in every table of the real project (see
-- README "Status") — the UPDATE ... FROM below is defensive/illustrative
-- for anyone applying this against a seeded environment, not a real
-- data-preservation backfill.

alter table unidades
  add column razao_social text,
  add column cnpj text,
  add column inscricao_municipal text,
  add column municipio_ibge char(7),
  add column inep_codigo text;

update unidades u
set razao_social = e.razao_social,
    cnpj = e.cnpj,
    municipio_ibge = e.municipio_ibge,
    inep_codigo = e.inep_codigo
from escolas e
where u.escola_id = e.id;

alter table unidades
  alter column razao_social set not null,
  alter column cnpj set not null,
  alter column municipio_ibge set not null,
  add constraint unidades_cnpj_valido check (fn_cnpj_valido(cnpj)),
  add constraint unidades_cnpj_unique unique (cnpj),
  add constraint unidades_municipio_ibge_formato check (municipio_ibge ~ '^[0-9]{7}$'),
  add constraint unidades_inep_codigo_formato
    check (inep_codigo is null or inep_codigo ~ '^[0-9]{8}$'),
  add constraint unidades_id_escola_unique unique (id, escola_id);

alter table escolas
  drop column cnpj,
  drop column municipio_ibge,
  drop column inep_codigo;

-- turmas now happens at a specific unidade — required for a
-- contrato/parcela/pagamento chain (turma -> matricula -> contrato) to
-- resolve which CNPJ a nota fiscal bills under. Every existing turma
-- (none in the real project — see above) is defensively assigned its
-- escola's first unidade so the NOT NULL below never fails.
alter table turmas add column unidade_id uuid;

update turmas t
set unidade_id = (
  select u.id from unidades u
  where u.escola_id = t.escola_id
  order by u.created_at
  limit 1
)
where unidade_id is null;

alter table turmas
  alter column unidade_id set not null,
  add constraint turmas_unidade_fk foreign key (unidade_id, escola_id)
    references unidades (id, escola_id);
create index idx_turmas_unidade on turmas (unidade_id);

-- notas_fiscais integration fields: which third-party provider issued
-- it (nfe.io / plugnotas / enotas / a município's own API — kept as free
-- text so a new provider needs no schema change) and its external
-- reference for idempotent webhook updates, mirroring the
-- asaas_pagamento_id / asaas_cobranca_id pattern already used for Asaas.
alter table notas_fiscais
  add column provedor text,
  add column referencia_externa text,
  add column erro_detalhe text,
  add column emitida_em timestamptz;
create unique index idx_notas_fiscais_referencia_externa
  on notas_fiscais (referencia_externa) where referencia_externa is not null;
