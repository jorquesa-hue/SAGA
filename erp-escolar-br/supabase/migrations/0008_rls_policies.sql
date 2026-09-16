-- RLS is enabled on every tenant-scoped table, no exceptions (spec §3.2).
-- No table ever gets a DELETE policy for the `authenticated` role: hard
-- deletes are not part of the app-level contract (spec §4 — soft delete
-- via deleted_at only), so DELETE is denied by default for every profile,
-- including admin. consentimentos_lgpd additionally has no UPDATE policy
-- (guarda permanente / append-only). logs_acesso has no INSERT/UPDATE
-- policy for any app role — it is written only by the SECURITY DEFINER
-- trigger in 0007_audit_trigger.sql.

alter table escolas enable row level security;
alter table unidades enable row level security;
alter table anos_letivos enable row level security;
alter table cursos enable row level security;
alter table turmas enable row level security;
alter table pessoas enable row level security;
alter table alunos enable row level security;
alter table responsaveis_alunos enable row level security;
alter table professores_turmas enable row level security;
alter table matriculas enable row level security;
alter table contratos enable row level security;
alter table descontos enable row level security;
alter table parcelas enable row level security;
alter table pagamentos enable row level security;
alter table notas_fiscais enable row level security;
alter table comunicados enable row level security;
alter table consentimentos_lgpd enable row level security;
alter table logs_acesso enable row level security;

grant usage on schema public to authenticated, anon;

-- ── escolas: a school manages only its own row. Creation happens via a
-- signup Edge Function using service_role (Milestone 2), so there is no
-- INSERT policy for `authenticated` here.
create policy escolas_select on escolas for select to authenticated
  using (id = fn_jwt_escola_id());

create policy escolas_update_admin on escolas for update to authenticated
  using (id = fn_jwt_escola_id() and fn_jwt_role() = 'admin')
  with check (id = fn_jwt_escola_id() and fn_jwt_role() = 'admin');

grant select, update on escolas to authenticated;

-- ── unidades / anos_letivos / cursos: organisational/catalog data, not
-- covered by spec §3.5/§3.6's narrower rules. Readable tenant-wide by any
-- authenticated profile; writable only by admin/secretaria.
create policy unidades_select on unidades for select to authenticated
  using (escola_id = fn_jwt_escola_id());
create policy unidades_insert_staff on unidades for insert to authenticated
  with check (escola_id = fn_jwt_escola_id() and fn_jwt_role() in ('admin', 'secretaria'));
create policy unidades_update_staff on unidades for update to authenticated
  using (escola_id = fn_jwt_escola_id() and fn_jwt_role() in ('admin', 'secretaria'))
  with check (escola_id = fn_jwt_escola_id() and fn_jwt_role() in ('admin', 'secretaria'));

create policy anos_letivos_select on anos_letivos for select to authenticated
  using (escola_id = fn_jwt_escola_id());
create policy anos_letivos_insert_staff on anos_letivos for insert to authenticated
  with check (escola_id = fn_jwt_escola_id() and fn_jwt_role() in ('admin', 'secretaria'));
create policy anos_letivos_update_staff on anos_letivos for update to authenticated
  using (escola_id = fn_jwt_escola_id() and fn_jwt_role() in ('admin', 'secretaria'))
  with check (escola_id = fn_jwt_escola_id() and fn_jwt_role() in ('admin', 'secretaria'));

create policy cursos_select on cursos for select to authenticated
  using (escola_id = fn_jwt_escola_id());
create policy cursos_insert_staff on cursos for insert to authenticated
  with check (escola_id = fn_jwt_escola_id() and fn_jwt_role() in ('admin', 'secretaria'));
create policy cursos_update_staff on cursos for update to authenticated
  using (escola_id = fn_jwt_escola_id() and fn_jwt_role() in ('admin', 'secretaria'))
  with check (escola_id = fn_jwt_escola_id() and fn_jwt_role() in ('admin', 'secretaria'));

grant select, insert, update on unidades, anos_letivos, cursos to authenticated;

-- ── turmas: spec §3.6 — professor only sees turmas assigned to him.
create policy turmas_select_staff on turmas for select to authenticated
  using (escola_id = fn_jwt_escola_id() and fn_jwt_role() in ('admin', 'secretaria'));

create policy turmas_select_professor on turmas for select to authenticated
  using (
    escola_id = fn_jwt_escola_id()
    and fn_jwt_role() = 'professor'
    and exists (
      select 1 from professores_turmas pt
      where pt.turma_id = turmas.id
        and pt.escola_id = turmas.escola_id
        and pt.professor_pessoa_id = fn_current_pessoa_id()
        and pt.deleted_at is null
    )
  );

create policy turmas_select_responsavel on turmas for select to authenticated
  using (
    escola_id = fn_jwt_escola_id()
    and fn_jwt_role() = 'responsavel'
    and exists (
      select 1
      from matriculas m
      join responsaveis_alunos ra on ra.aluno_id = m.aluno_id and ra.escola_id = m.escola_id
      where m.turma_id = turmas.id
        and m.escola_id = turmas.escola_id
        and ra.responsavel_pessoa_id = fn_current_pessoa_id()
        and ra.deleted_at is null
        and m.deleted_at is null
    )
  );

create policy turmas_insert_staff on turmas for insert to authenticated
  with check (escola_id = fn_jwt_escola_id() and fn_jwt_role() in ('admin', 'secretaria'));
create policy turmas_update_staff on turmas for update to authenticated
  using (escola_id = fn_jwt_escola_id() and fn_jwt_role() in ('admin', 'secretaria'))
  with check (escola_id = fn_jwt_escola_id() and fn_jwt_role() in ('admin', 'secretaria'));

grant select, insert, update on turmas to authenticated;

-- ── pessoas: staff see everyone in the escola; everyone sees their own
-- record; professor sees alunos in their turmas; responsavel sees own
-- dependentes (spec §3.5).
create policy pessoas_select_staff on pessoas for select to authenticated
  using (escola_id = fn_jwt_escola_id() and fn_jwt_role() in ('admin', 'secretaria'));

create policy pessoas_select_self on pessoas for select to authenticated
  using (escola_id = fn_jwt_escola_id() and id = fn_current_pessoa_id());

create policy pessoas_select_professor_alunos on pessoas for select to authenticated
  using (
    escola_id = fn_jwt_escola_id()
    and fn_jwt_role() = 'professor'
    and exists (
      select 1
      from alunos al
      join matriculas m on m.aluno_id = al.id and m.escola_id = al.escola_id
      join professores_turmas pt on pt.turma_id = m.turma_id and pt.escola_id = m.escola_id
      where al.pessoa_id = pessoas.id
        and al.escola_id = pessoas.escola_id
        and pt.professor_pessoa_id = fn_current_pessoa_id()
        and pt.deleted_at is null
        and m.deleted_at is null
        and al.deleted_at is null
    )
  );

create policy pessoas_select_responsavel_dependentes on pessoas for select to authenticated
  using (
    escola_id = fn_jwt_escola_id()
    and fn_jwt_role() = 'responsavel'
    and exists (
      select 1
      from alunos al
      join responsaveis_alunos ra on ra.aluno_id = al.id and ra.escola_id = al.escola_id
      where al.pessoa_id = pessoas.id
        and al.escola_id = pessoas.escola_id
        and ra.responsavel_pessoa_id = fn_current_pessoa_id()
        and ra.deleted_at is null
        and al.deleted_at is null
    )
  );

create policy pessoas_insert_staff on pessoas for insert to authenticated
  with check (escola_id = fn_jwt_escola_id() and fn_jwt_role() in ('admin', 'secretaria'));
create policy pessoas_update_staff on pessoas for update to authenticated
  using (escola_id = fn_jwt_escola_id() and fn_jwt_role() in ('admin', 'secretaria'))
  with check (escola_id = fn_jwt_escola_id() and fn_jwt_role() in ('admin', 'secretaria'));

grant select, insert, update on pessoas to authenticated;

-- ── alunos
create policy alunos_select_staff on alunos for select to authenticated
  using (escola_id = fn_jwt_escola_id() and fn_jwt_role() in ('admin', 'secretaria'));

create policy alunos_select_professor on alunos for select to authenticated
  using (
    escola_id = fn_jwt_escola_id()
    and fn_jwt_role() = 'professor'
    and exists (
      select 1 from matriculas m
      join professores_turmas pt on pt.turma_id = m.turma_id and pt.escola_id = m.escola_id
      where m.aluno_id = alunos.id
        and m.escola_id = alunos.escola_id
        and pt.professor_pessoa_id = fn_current_pessoa_id()
        and pt.deleted_at is null
        and m.deleted_at is null
    )
  );

create policy alunos_select_responsavel on alunos for select to authenticated
  using (
    escola_id = fn_jwt_escola_id()
    and fn_jwt_role() = 'responsavel'
    and exists (
      select 1 from responsaveis_alunos ra
      where ra.aluno_id = alunos.id
        and ra.escola_id = alunos.escola_id
        and ra.responsavel_pessoa_id = fn_current_pessoa_id()
        and ra.deleted_at is null
    )
  );

create policy alunos_insert_staff on alunos for insert to authenticated
  with check (escola_id = fn_jwt_escola_id() and fn_jwt_role() in ('admin', 'secretaria'));
create policy alunos_update_staff on alunos for update to authenticated
  using (escola_id = fn_jwt_escola_id() and fn_jwt_role() in ('admin', 'secretaria'))
  with check (escola_id = fn_jwt_escola_id() and fn_jwt_role() in ('admin', 'secretaria'));

grant select, insert, update on alunos to authenticated;

-- ── responsaveis_alunos
create policy responsaveis_alunos_select_staff on responsaveis_alunos for select to authenticated
  using (escola_id = fn_jwt_escola_id() and fn_jwt_role() in ('admin', 'secretaria'));

create policy responsaveis_alunos_select_self on responsaveis_alunos for select to authenticated
  using (
    escola_id = fn_jwt_escola_id()
    and fn_jwt_role() = 'responsavel'
    and responsavel_pessoa_id = fn_current_pessoa_id()
  );

create policy responsaveis_alunos_insert_staff on responsaveis_alunos for insert to authenticated
  with check (escola_id = fn_jwt_escola_id() and fn_jwt_role() in ('admin', 'secretaria'));
create policy responsaveis_alunos_update_staff on responsaveis_alunos for update to authenticated
  using (escola_id = fn_jwt_escola_id() and fn_jwt_role() in ('admin', 'secretaria'))
  with check (escola_id = fn_jwt_escola_id() and fn_jwt_role() in ('admin', 'secretaria'));

grant select, insert, update on responsaveis_alunos to authenticated;

-- ── professores_turmas
create policy professores_turmas_select_staff on professores_turmas for select to authenticated
  using (escola_id = fn_jwt_escola_id() and fn_jwt_role() in ('admin', 'secretaria'));

create policy professores_turmas_select_self on professores_turmas for select to authenticated
  using (
    escola_id = fn_jwt_escola_id()
    and fn_jwt_role() = 'professor'
    and professor_pessoa_id = fn_current_pessoa_id()
  );

create policy professores_turmas_insert_staff on professores_turmas for insert to authenticated
  with check (escola_id = fn_jwt_escola_id() and fn_jwt_role() in ('admin', 'secretaria'));
create policy professores_turmas_update_staff on professores_turmas for update to authenticated
  using (escola_id = fn_jwt_escola_id() and fn_jwt_role() in ('admin', 'secretaria'))
  with check (escola_id = fn_jwt_escola_id() and fn_jwt_role() in ('admin', 'secretaria'));

grant select, insert, update on professores_turmas to authenticated;

-- ── matriculas
create policy matriculas_select_staff on matriculas for select to authenticated
  using (escola_id = fn_jwt_escola_id() and fn_jwt_role() in ('admin', 'secretaria'));

create policy matriculas_select_professor on matriculas for select to authenticated
  using (
    escola_id = fn_jwt_escola_id()
    and fn_jwt_role() = 'professor'
    and exists (
      select 1 from professores_turmas pt
      where pt.turma_id = matriculas.turma_id
        and pt.escola_id = matriculas.escola_id
        and pt.professor_pessoa_id = fn_current_pessoa_id()
        and pt.deleted_at is null
    )
  );

create policy matriculas_select_responsavel on matriculas for select to authenticated
  using (
    escola_id = fn_jwt_escola_id()
    and fn_jwt_role() = 'responsavel'
    and exists (
      select 1 from responsaveis_alunos ra
      where ra.aluno_id = matriculas.aluno_id
        and ra.escola_id = matriculas.escola_id
        and ra.responsavel_pessoa_id = fn_current_pessoa_id()
        and ra.deleted_at is null
    )
  );

create policy matriculas_insert_staff on matriculas for insert to authenticated
  with check (escola_id = fn_jwt_escola_id() and fn_jwt_role() in ('admin', 'secretaria'));
create policy matriculas_update_staff on matriculas for update to authenticated
  using (escola_id = fn_jwt_escola_id() and fn_jwt_role() in ('admin', 'secretaria'))
  with check (escola_id = fn_jwt_escola_id() and fn_jwt_role() in ('admin', 'secretaria'));

grant select, insert, update on matriculas to authenticated;

-- ── financeiro (contratos, descontos, parcelas, pagamentos, notas_fiscais):
-- staff full CRUD (minus delete); responsavel SELECT-only, gated on
-- responsaveis_alunos.financeiro = true for the linked aluno; professor has
-- no access (data minimisation — financeiro is out of pedagogical scope).
-- The Asaas webhook (Milestone 5) will write parcelas.status/pagamentos via
-- an Edge Function using service_role, which bypasses RLS and is
-- unaffected by these client-facing policies.
create policy contratos_select_staff on contratos for select to authenticated
  using (escola_id = fn_jwt_escola_id() and fn_jwt_role() in ('admin', 'secretaria'));
create policy contratos_select_responsavel on contratos for select to authenticated
  using (
    escola_id = fn_jwt_escola_id()
    and fn_jwt_role() = 'responsavel'
    and exists (
      select 1 from matriculas m
      join responsaveis_alunos ra on ra.aluno_id = m.aluno_id and ra.escola_id = m.escola_id
      where m.id = contratos.matricula_id
        and m.escola_id = contratos.escola_id
        and ra.responsavel_pessoa_id = fn_current_pessoa_id()
        and ra.financeiro = true
        and ra.deleted_at is null
    )
  );
create policy contratos_insert_staff on contratos for insert to authenticated
  with check (escola_id = fn_jwt_escola_id() and fn_jwt_role() in ('admin', 'secretaria'));
create policy contratos_update_staff on contratos for update to authenticated
  using (escola_id = fn_jwt_escola_id() and fn_jwt_role() in ('admin', 'secretaria'))
  with check (escola_id = fn_jwt_escola_id() and fn_jwt_role() in ('admin', 'secretaria'));

create policy descontos_select_staff on descontos for select to authenticated
  using (escola_id = fn_jwt_escola_id() and fn_jwt_role() in ('admin', 'secretaria'));
create policy descontos_select_responsavel on descontos for select to authenticated
  using (
    escola_id = fn_jwt_escola_id()
    and fn_jwt_role() = 'responsavel'
    and exists (
      select 1 from contratos c
      join matriculas m on m.id = c.matricula_id and m.escola_id = c.escola_id
      join responsaveis_alunos ra on ra.aluno_id = m.aluno_id and ra.escola_id = m.escola_id
      where c.id = descontos.contrato_id
        and c.escola_id = descontos.escola_id
        and ra.responsavel_pessoa_id = fn_current_pessoa_id()
        and ra.financeiro = true
        and ra.deleted_at is null
    )
  );
create policy descontos_insert_staff on descontos for insert to authenticated
  with check (escola_id = fn_jwt_escola_id() and fn_jwt_role() in ('admin', 'secretaria'));
create policy descontos_update_staff on descontos for update to authenticated
  using (escola_id = fn_jwt_escola_id() and fn_jwt_role() in ('admin', 'secretaria'))
  with check (escola_id = fn_jwt_escola_id() and fn_jwt_role() in ('admin', 'secretaria'));

create policy parcelas_select_staff on parcelas for select to authenticated
  using (escola_id = fn_jwt_escola_id() and fn_jwt_role() in ('admin', 'secretaria'));
create policy parcelas_select_responsavel on parcelas for select to authenticated
  using (
    escola_id = fn_jwt_escola_id()
    and fn_jwt_role() = 'responsavel'
    and exists (
      select 1 from contratos c
      join matriculas m on m.id = c.matricula_id and m.escola_id = c.escola_id
      join responsaveis_alunos ra on ra.aluno_id = m.aluno_id and ra.escola_id = m.escola_id
      where c.id = parcelas.contrato_id
        and c.escola_id = parcelas.escola_id
        and ra.responsavel_pessoa_id = fn_current_pessoa_id()
        and ra.financeiro = true
        and ra.deleted_at is null
    )
  );
create policy parcelas_insert_staff on parcelas for insert to authenticated
  with check (escola_id = fn_jwt_escola_id() and fn_jwt_role() in ('admin', 'secretaria'));
create policy parcelas_update_staff on parcelas for update to authenticated
  using (escola_id = fn_jwt_escola_id() and fn_jwt_role() in ('admin', 'secretaria'))
  with check (escola_id = fn_jwt_escola_id() and fn_jwt_role() in ('admin', 'secretaria'));

create policy pagamentos_select_staff on pagamentos for select to authenticated
  using (escola_id = fn_jwt_escola_id() and fn_jwt_role() in ('admin', 'secretaria'));
create policy pagamentos_select_responsavel on pagamentos for select to authenticated
  using (
    escola_id = fn_jwt_escola_id()
    and fn_jwt_role() = 'responsavel'
    and exists (
      select 1 from parcelas p
      join contratos c on c.id = p.contrato_id and c.escola_id = p.escola_id
      join matriculas m on m.id = c.matricula_id and m.escola_id = c.escola_id
      join responsaveis_alunos ra on ra.aluno_id = m.aluno_id and ra.escola_id = m.escola_id
      where p.id = pagamentos.parcela_id
        and p.escola_id = pagamentos.escola_id
        and ra.responsavel_pessoa_id = fn_current_pessoa_id()
        and ra.financeiro = true
        and ra.deleted_at is null
    )
  );
create policy pagamentos_insert_staff on pagamentos for insert to authenticated
  with check (escola_id = fn_jwt_escola_id() and fn_jwt_role() in ('admin', 'secretaria'));
create policy pagamentos_update_staff on pagamentos for update to authenticated
  using (escola_id = fn_jwt_escola_id() and fn_jwt_role() in ('admin', 'secretaria'))
  with check (escola_id = fn_jwt_escola_id() and fn_jwt_role() in ('admin', 'secretaria'));

create policy notas_fiscais_select_staff on notas_fiscais for select to authenticated
  using (escola_id = fn_jwt_escola_id() and fn_jwt_role() in ('admin', 'secretaria'));
create policy notas_fiscais_select_responsavel on notas_fiscais for select to authenticated
  using (
    escola_id = fn_jwt_escola_id()
    and fn_jwt_role() = 'responsavel'
    and exists (
      select 1 from pagamentos pg
      join parcelas p on p.id = pg.parcela_id and p.escola_id = pg.escola_id
      join contratos c on c.id = p.contrato_id and c.escola_id = p.escola_id
      join matriculas m on m.id = c.matricula_id and m.escola_id = c.escola_id
      join responsaveis_alunos ra on ra.aluno_id = m.aluno_id and ra.escola_id = m.escola_id
      where pg.id = notas_fiscais.pagamento_id
        and pg.escola_id = notas_fiscais.escola_id
        and ra.responsavel_pessoa_id = fn_current_pessoa_id()
        and ra.financeiro = true
        and ra.deleted_at is null
    )
  );
create policy notas_fiscais_insert_staff on notas_fiscais for insert to authenticated
  with check (escola_id = fn_jwt_escola_id() and fn_jwt_role() in ('admin', 'secretaria'));
create policy notas_fiscais_update_staff on notas_fiscais for update to authenticated
  using (escola_id = fn_jwt_escola_id() and fn_jwt_role() in ('admin', 'secretaria'))
  with check (escola_id = fn_jwt_escola_id() and fn_jwt_role() in ('admin', 'secretaria'));

grant select, insert, update on contratos, descontos, parcelas, pagamentos, notas_fiscais
  to authenticated;

-- ── comunicados: staff write; readable tenant-wide (publico_alvo targeting
-- is an application-layer concern, not a tenant-isolation concern).
create policy comunicados_select on comunicados for select to authenticated
  using (escola_id = fn_jwt_escola_id());
create policy comunicados_insert_staff on comunicados for insert to authenticated
  with check (escola_id = fn_jwt_escola_id() and fn_jwt_role() in ('admin', 'secretaria'));
create policy comunicados_update_staff on comunicados for update to authenticated
  using (escola_id = fn_jwt_escola_id() and fn_jwt_role() in ('admin', 'secretaria'))
  with check (escola_id = fn_jwt_escola_id() and fn_jwt_role() in ('admin', 'secretaria'));

grant select, insert, update on comunicados to authenticated;

-- ── consentimentos_lgpd: append-only. Staff and the responsavel/titular
-- themselves may insert (self-registering consent); nobody may update or
-- delete (no such policies exist).
create policy consentimentos_lgpd_select_staff on consentimentos_lgpd for select to authenticated
  using (escola_id = fn_jwt_escola_id() and fn_jwt_role() in ('admin', 'secretaria'));
create policy consentimentos_lgpd_select_self on consentimentos_lgpd for select to authenticated
  using (
    escola_id = fn_jwt_escola_id()
    and (titular_pessoa_id = fn_current_pessoa_id() or responsavel_pessoa_id = fn_current_pessoa_id())
  );
create policy consentimentos_lgpd_insert on consentimentos_lgpd for insert to authenticated
  with check (
    escola_id = fn_jwt_escola_id()
    and (
      fn_jwt_role() in ('admin', 'secretaria')
      or responsavel_pessoa_id = fn_current_pessoa_id()
    )
  );

grant select, insert on consentimentos_lgpd to authenticated;

-- ── logs_acesso: admin-only read; no direct write grant for any app role
-- (see 0007_audit_trigger.sql).
create policy logs_acesso_select_admin on logs_acesso for select to authenticated
  using (escola_id = fn_jwt_escola_id() and fn_jwt_role() = 'admin');

grant select on logs_acesso to authenticated;
