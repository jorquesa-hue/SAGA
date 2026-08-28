# ERP Escolar BR

A **separate, unrelated product** living inside the SAGA repository at the
explicit request of the repo owner. SAGA itself (everything outside this
directory) is a livestock/farm operating system governed by `CLAUDE.md` and
spec JK-PLT-EES-001 — none of that applies here. This directory is
self-contained: its own `package.json`, its own dependencies, not part of
the root `pnpm-workspace.yaml`, and not subject to SAGA's
`architecture:check`/`contracts:validate`/traceability-matrix conventions.

Spec: the uploaded `erp-escolar-br-arquitetura.md` (Brazilian school ERP,
Supabase + Next.js + Make.com + Asaas + WhatsApp stack). Per that document's
own execution instructions (§6): work in milestone order, and **stop after
each milestone for review** rather than running straight through all eight.

## Status

**Milestone 1 — Schema + RLS: done.** Milestones 2–8 (Auth, Cadastros,
Contratos e parcelas, Asaas, Portal do responsável, Painel da direção,
Réguas no Make) are **not started**.

## What's here

```
erp-escolar-br/
  supabase/migrations/     8 SQL migrations: enums, validation functions,
                            core cadastros, financeiro, comunicação/LGPD/logs,
                            audit trigger, RLS policies + grants
  tests/
    support/local-auth-shim.sql   test-only auth.jwt()/auth.uid() stub +
                                    authenticated/anon/app_test_user roles
    fixtures/                     two synthetic escolas (A, B) with a full
                                    staff/aluno/responsavel/financeiro chain
    tenant-isolation.test.mjs     106 cases: the spec-mandated attack suite
  scripts/db-reset.mjs      applies migrations (+ shim/fixtures) to a
                              target Postgres
  docker-compose.yml        local Postgres 16 on port 5433 (kept off 5432
                              so it never collides with SAGA's own compose)
```

No UI, no Supabase Auth wiring, no Asaas/Make integration yet — Milestone 1
is schema and RLS only, per the spec's own milestone-1 scope ("Nada de UI
ainda").

## Running it locally

```bash
cd erp-escolar-br
npm install
cp .env.example .env   # edit if you're not using the default compose ports

docker compose up -d
# wait for the healthcheck, then:
export $(cat .env | xargs)
npm run db:reset:test          # applies the local auth shim + all
                                # migrations + the two-escola fixture
npm run test:tenant-isolation  # the mandatory cross-tenant attack suite
```

`db:reset:test` sets `LOCAL_TEST_SHIM=1 APPLY_FIXTURES=1`; plain
`npm run db:reset` (using only `ADMIN_DATABASE_URL`) applies just the
versioned migrations, which is the command to point at a real Supabase
project — `auth.jwt()`/`auth.uid()` and the `authenticated`/`anon` roles
already exist there, so the shim must **not** be applied.

## Multi-tenancy (spec §3)

- Every domain table carries `escola_id uuid not null references escolas(id)`.
- RLS is enabled (and policies attached) on all 18 tenant-scoped tables,
  no exceptions.
- Every child→parent reference uses a **composite foreign key** —
  `unique (id, escola_id)` on the parent, `foreign key (parent_id, escola_id)
  references parent(id, escola_id)` on the child — so a row can never point
  at a parent belonging to a different escola, as defense-in-depth
  alongside RLS.
- `escola_id` and `role` are custom JWT claims, read via `fn_jwt_escola_id()`
  / `fn_jwt_role()` (thin wrappers over `auth.jwt()`), never derived from
  anything client-supplied.
- No table ever gets a `DELETE` policy or grant, for any profile — hard
  deletes are not part of the app-level contract (`deleted_at` + RLS
  filtering only). `consentimentos_lgpd` additionally has no `UPDATE`
  grant (append-only / guarda permanente). `logs_acesso` has no
  `INSERT`/`UPDATE` grant for any app role — it is written only by the
  `SECURITY DEFINER` audit trigger.
- `tests/tenant-isolation.test.mjs` is the mandatory suite from spec §3:
  for every profile in escola A (admin, secretaria, professor, responsável,
  and a second responsável with no linked aluno), it asserts **zero** rows
  of escola B come back across every tenant table, plus active INSERT/
  UPDATE attack attempts against escola B's known row IDs, plus
  within-tenant role-scoping (a professor only sees his assigned turma's
  aluno, not the school's other turma; a responsável only sees his own
  dependente). 106/106 passing locally.

## Desvios da especificação (flagged, not silent)

The spec says: *"Se encontrar uma contradição na spec, pare e pergunte em
vez de decidir sozinho."* These are gaps, not contradictions — additions
needed to implement an explicit requirement that had no table to hang off
of. Flagged here for review rather than decided silently:

1. **`professores_turmas` table** — not in §4's table list. Added because
   §3.6 ("Professor só enxerga as turmas atribuídas a ele") is a
   non-negotiable RLS rule with nothing else to scope it against.
2. **`role` custom JWT claim** — §3.4 only names `escola_id` as a custom
   claim. A second claim (`role`, one of admin/secretaria/professor/
   responsavel) was added, server-set at signup/invite exactly like
   `escola_id`, because the four-profile model in §3 has no other
   claims mechanism specified.
3. **`fn_current_pessoa_id()`** — resolves the caller's own `pessoas.id`
   from `auth.uid()` via `pessoas.auth_user_id`, instead of a third custom
   claim. Chosen over a `pessoa_id` JWT claim to avoid a claim that could
   drift from the `pessoas` table; this is Supabase's documented pattern
   for identity lookups inside RLS policies.
4. **Enum sets** (`parcela_status`, `nota_fiscal_status`, `matricula_status`
   values, etc.) — §4 says "status" without enumerating values for most
   fields. Reasonable domain-standard values were chosen; revisit once
   Milestone 4/5 business logic is built out and the real state machine is
   known.
5. **CPF is nullable on `pessoas`** — most `aluno` rows won't have one
   (minors). Validity (`fn_cpf_valido`) is still enforced whenever a CPF
   *is* present.

## Guardrails honored (spec §6)

- Zero `service_role` usage anywhere in this milestone (no app code yet).
- Every table born in this milestone ships with RLS enabled in the same
  migration set — `0008_rls_policies.sql` is exhaustive, no table is
  missing a policy.
- All monetary columns are `numeric(12,2)`.
- `ALTER DATABASE ... SET timezone TO 'America/Sao_Paulo'` (session
  default); all columns needing wall-clock semantics are `timestamptz`.
- CPF/CNPJ are validated in the database via `fn_cpf_valido`/`fn_cnpj_valido`
  (real mod-11 check-digit algorithms, not format-only), as `CHECK`
  constraints — not only client-side.
- No real student/personal data anywhere: `tests/fixtures/seed-two-escolas.sql`
  is entirely synthetic (placeholder names, CPF/CNPJ numbers with valid
  check digits but no correspondence to real people or companies).

## Not yet done — do not treat as production-ready

- No Supabase Auth signup/invite flow (Milestone 2) — the `role`/`escola_id`
  claims and `pessoas.auth_user_id` linkage assumed by the RLS policies
  here have no code that sets them yet.
- No application code, no UI, no Edge Functions, no Asaas/Make/WhatsApp
  integration.
- No termo de uso / política de privacidade / contrato de operador de
  dados — per spec §6, real student data must never be loaded before those
  exist.
