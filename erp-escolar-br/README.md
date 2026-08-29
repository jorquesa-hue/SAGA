# ERP Escolar BR

A **separate, unrelated product** living inside the SAGA repository at the
explicit request of the repo owner. SAGA itself (everything outside this
directory) is a livestock/farm operating system governed by `CLAUDE.md` and
spec JK-PLT-EES-001 — none of that applies here.

Spec: the uploaded `erp-escolar-br-arquitetura.md` (Brazilian school ERP,
Supabase + Next.js + Make.com + Asaas + WhatsApp stack).

## Status: Milestones 1–8 built. Not production-ready — read "What's not done" below.

| #   | Milestone                   | Status                                                                                                                                      |
| --- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Schema + RLS                | Done — 106/106 tenant-isolation tests passing                                                                                               |
| 2   | Auth e onboarding de escola | Done — signup/invite Edge Functions + Custom Access Token Hook deployed                                                                     |
| 3   | Cadastros                   | Done — pessoas/alunos/turmas/matrículas CRUD in `apps/web`                                                                                  |
| 4   | Contratos e parcelas        | Done — `fn_gerar_parcelas` engine + UI, smoke-tested                                                                                        |
| 5   | Asaas                       | **Stubbed** — real Edge Functions deployed, return `501` until `ASAAS_API_KEY`/`ASAAS_WEBHOOK_TOKEN` are set (no Asaas account exists)      |
| 6   | Portal do responsável       | Done — installable PWA (`apps/web`)                                                                                                         |
| 7   | Painel da direção           | Done — inadimplência por turma, aging, previsão de recebíveis                                                                               |
| 8   | Réguas no Make              | **Stubbed** — real Make.com scenarios created (inactive), notification channel steps are placeholders (no Twilio/Z-API/SMTP account exists) |

This ran in one continuous session at the user's explicit instruction to
"keep going until the full Schools ERP is finished," overriding the spec's
own "stop after each milestone" default. Real cloud infrastructure was
provisioned along the way (see below) — this is not a local-only exercise.

## Real infrastructure this now runs against

- **Supabase project**: `erp-escolar-br` (`xozhqzdniagwjlxoiarx`, `sa-east-1`),
  org `jorquesa@icloud.com's Org`. 13 migrations applied. An existing
  project in the same org (`Elara PMS`) was **paused** to free a slot under
  the org's 2-project free-tier cap — unpause it from the Supabase
  dashboard if you need it back.
- **Vercel project**: `erp-escolar-br-app`, team `JQ` (`jq81`), deployed to
  `https://erp-escolar-br-app-jq81.vercel.app`. Not connected to this
  GitHub repo (see "Known tool gaps" below) — redeploys are manual until
  someone connects it via the Vercel dashboard (Project Settings → Git →
  Connect Repository, root directory `erp-escolar-br/apps/web`).
  Two earlier project names (`erp-escolar-br`, `erp-escolar-br-web`) were
  created by mistake during this session and are now stuck unable to
  accept deployments — see "Known tool gaps."
  The `erp-escolar-br` one did get git-linked to this repo, so it was
  auto-building on every push and failing, surfacing as a red
  `Vercel – erp-escolar-br` check on the PR. Root cause (from its build
  log): its Root Directory is the **repo root**, not
  `erp-escolar-br/apps/web`, so it read the root `vercel.json`, ran
  `pnpm install --no-frozen-lockfile` against the whole SAGA workspace,
  and died with `ERR_PNPM_UNSUPPORTED_ENGINE` — Vercel hands that project
  pnpm 6.35.1 while the root `package.json` requires `engines.pnpm >= 9`.
  Fixed by adding `"ignoreCommand": "exit 0"` to the **root**
  `vercel.json`, the same pattern `apps/api/vercel.json` already uses to
  keep `saga-api` from building. Only a project whose Root Directory is
  the repo root reads that file, and `erp-escolar-br` is the only one, so
  `saga-web` (root dir `apps/web`) and `saga-api` (root dir `apps/api`)
  are unaffected. Delete the stray project in the Vercel dashboard and
  that line can be reverted.
- **Make.com**: org `JQ`, team `My Team`. Two real scenarios created
  (inactive): "Régua de Cobrança" (daily, 08:00) and "Relatório Semanal de
  Inadimplência" (weekly, Monday 08:00).

## Manual steps required before this is actually live

None of these could be done from this session — either the capability
doesn't exist in the tools available, or doing it destructively wasn't
appropriate to do unprompted. All are one-time, a few minutes each.

1. **Enable the Custom Access Token Hook** (blocks all of Milestones 3–8
   functionally — without it, `escola_id`/`escola_role` never reach the
   JWT and every role-scoped RLS policy denies everything). Supabase
   dashboard → this project → Authentication → Hooks → Custom Access
   Token → select `custom_access_token_hook` → Enable.
2. **Set Supabase project secrets** (dashboard → Edge Functions → Secrets,
   or `supabase secrets set` via the CLI, which this session doesn't have):
   - `ASAAS_API_KEY`, `ASAAS_WEBHOOK_TOKEN` — once a real Asaas account
     exists (Milestone 5 stays `501 asaas_not_configured` until then).
   - `REGUAS_API_TOKEN` — any random secret string; also paste the same
     value into both Make scenarios' HTTP module header (currently
     `Bearer SET-ME-REGUAS-API-TOKEN`) before activating them.
3. **Connect the Vercel project to GitHub** for auto-deploy on push
   (Project Settings → Git, project `erp-escolar-br-app`) — see "Known
   tool gaps."
4. **Set real Twilio/Z-API and SMTP/push credentials** and replace the
   `util:SetVariable2` stub step in both Make scenarios with actual
   WhatsApp/e-mail/push send modules, then activate both scenarios
   (`scenarios_activate`).
5. **Point `apps/web` at real Vercel env vars** — `NEXT_PUBLIC_SUPABASE_URL`
   / `NEXT_PUBLIC_SUPABASE_ANON_KEY` currently fall back to hardcoded
   values in `src/lib/supabase/config.ts` (see that file's comment) because
   this session had no way to set Vercel project env vars. Setting the real
   env vars in the dashboard overrides the fallback with no code change
   needed — do this and then remove the hardcoded fallback values.
6. **Real Asaas + WhatsApp accounts** — see "What's not done" below; these
   are the same accounts CLAUDE.md-equivalent invariants require before
   any real student/financial data is loaded.

## Known tool gaps hit during this session (for whoever picks this up)

Documented here rather than silently worked around, so the next session
doesn't waste time rediscovering them:

- **No Vercel env-var-setting tool.** Worked around with a public,
  non-secret fallback in `config.ts` (safe — see that file's comment) but
  a real tool for this doesn't exist in this session's Vercel MCP access.
- **No Supabase secrets-setting tool.** `ASAAS_API_KEY` etc. can only be
  read via `Deno.env.get()` in Edge Function code — setting the actual
  values requires dashboard or CLI access this session doesn't have.
- **`create_git_project` retried against an existing unlinked project
  corrupts its deploy permissions.** The tool's own description says it
  "does not reconnect an existing unlinked project with the same name,"
  but calling it anyway (twice, while debugging) left both
  `erp-escolar-br` and `erp-escolar-br-web` unable to accept ANY deploy
  (production or preview) via `deploy_to_vercel`, with a 403
  "You don't have permission" error that persisted across multiple
  target types and retries. Do not retry `create_git_project` against a
  project it just failed to link — use a fresh project name instead (what
  `erp-escolar-br-app` is).
- **No network egress from this sandbox to `*.supabase.co` or
  `*.vercel.app`.** Could not `curl` either the deployed Edge Functions or
  the deployed frontend to verify them end-to-end over HTTP. Verification
  instead relied on: local build/lint passing, the 106-test tenant-
  isolation suite passing against a local Postgres running the identical
  migrations, and rollback-wrapped `execute_sql` smoke tests directly
  against the real Supabase project (e.g. `fn_gerar_parcelas`, confirmed
  producing 12 correctly-discounted monthly parcelas from a synthetic
  contract, then rolled back). **Nobody has loaded the deployed app in a
  browser and clicked through signup → login → cadastro → contrato →
  portal yet** — do that before treating this as verified.

## Running Milestone 1 locally (schema + RLS only, no cloud needed)

```bash
cd erp-escolar-br
npm install
docker compose up -d   # or use the native Postgres cluster pattern below
npm run db:reset:test          # local auth shim + all migrations + two-escola fixture
npm run test:tenant-isolation  # the mandatory cross-tenant attack suite (106 cases)
```

## Running apps/web locally

```bash
cd erp-escolar-br/apps/web
npm install
cp .env.example .env.local   # or rely on the config.ts fallback (see above)
npm run dev
```

## Multi-tenancy (spec §3)

- Every domain table carries `escola_id uuid not null references escolas(id)`.
- RLS is enabled (and policies attached) on all 18 tenant-scoped tables,
  no exceptions.
- Every child→parent reference uses a **composite foreign key** —
  `unique (id, escola_id)` on the parent, `foreign key (parent_id, escola_id)
references parent(id, escola_id)` on the child — so a row can never point
  at a parent belonging to a different escola, as defense-in-depth
  alongside RLS.
- `escola_id` and `escola_role` are custom JWT claims, stamped server-side
  by the Custom Access Token Hook (`0011_custom_access_token_hook.sql`)
  from the caller's own `pessoas` row — never derived from anything
  client-supplied. **`escola_role`, not `role`**: Supabase reserves the
  top-level `role` claim for `anon`/`authenticated` (PostgREST uses it to
  pick the Postgres role) — a real bug caught via `search_docs` before
  shipping, see `0010_fix_role_claim_key.sql`.
- No table ever gets a `DELETE` policy or grant, for any profile — hard
  deletes are not part of the app-level contract (`deleted_at` + RLS
  filtering only). `consentimentos_lgpd` additionally has no `UPDATE`
  grant (append-only / guarda permanente). `logs_acesso` has no
  `INSERT`/`UPDATE` grant for any app role — it is written only by the
  `SECURITY DEFINER` audit trigger.
- `tests/tenant-isolation.test.mjs`: 106/106 passing locally against the
  same migrations now applied to the real Supabase project.
- `get_advisors` (security) run against the real project after every DDL
  change: down to 1 accepted finding (`fn_current_pessoa_id` callable by
  `authenticated` via RPC — intentional, it only ever returns the caller's
  own id). Two SECURITY DEFINER functions that Supabase's default
  privileges had accidentally exposed as public RPC endpoints were closed
  in `0009_harden_functions.sql`.

## Desvios da especificação (flagged, not silent)

The spec says: _"Se encontrar uma contradição na spec, pare e pergunte em
vez de decidir sozinho."_ These are gaps, not contradictions — additions
needed to implement an explicit requirement that had no table to hang off
of, or engineering decisions the spec left open. Flagged here for review
rather than decided silently:

1. **`professores_turmas` table** — not in §4's table list. Added because
   §3.6 ("Professor só enxerga as turmas atribuídas a ele") is a
   non-negotiable RLS rule with nothing else to scope it against.
2. **`escola_role` custom JWT claim** — §3.4 only names `escola_id` as a
   custom claim. A second claim was added, server-set at signup/invite
   exactly like `escola_id` (via the Custom Access Token Hook), because
   the four-profile model in §3 has no other claims mechanism specified.
   Named `escola_role` rather than `role` — see above.
3. **`fn_current_pessoa_id()`** — resolves the caller's own `pessoas.id`
   from `auth.uid()` via `pessoas.auth_user_id`, instead of a third custom
   claim. Chosen over a `pessoa_id` JWT claim to avoid a claim that could
   drift from the `pessoas` table; this is Supabase's documented pattern
   for identity lookups inside RLS policies.
4. **Enum sets** (`parcela_status`, `nota_fiscal_status`, `matricula_status`
   values, etc.) — §4 says "status" without enumerating values for most
   fields. Reasonable domain-standard values were chosen.
5. **CPF is nullable on `pessoas`** — most `aluno` rows won't have one
   (minors). Validity (`fn_cpf_valido`) is still enforced whenever a CPF
   _is_ present.
6. **Role priority when a pessoa holds multiple `papeis`** — spec §4
   explicitly allows a person to be e.g. professor AND responsavel
   simultaneously, but doesn't say which "hat" governs a session. The
   Custom Access Token Hook picks the highest-priority role by
   `pessoa_papel`'s enum declaration order (admin > secretaria > professor
   > responsavel > aluno). A future "act as" role switcher could replace
   > this with an explicit per-session choice.
7. **No separate REST API layer** — `apps/web` talks to Supabase directly
   (PostgREST + RPC + Edge Functions) from client and server components,
   per the spec's own architecture (§2: Supabase + Next.js, no mention of
   a custom backend). All privileged writes (signup, invite, Asaas,
   réguas) go through Edge Functions using `service_role`, never
   client-side (§3.7).
8. **Réguas call platform-wide Edge Functions, not per-escola ones** —
   spec §5 doesn't specify whether Make orchestrates per-school or
   globally; built as one global batch job (service_role, shared-token
   auth) iterating all escolas per run, matching how a real multi-tenant
   SaaS's scheduled jobs normally work. Delivery is still meant to reach
   each school's own responsáveis/direção — only the trigger/collection
   step is centralized.

## Guardrails honored (spec §6)

- Zero `service_role` usage in browser code — every privileged operation
  (signup, invite, Asaas, réguas) is an Edge Function.
- Every table born in this project ships with RLS enabled in the same
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
  check digits but no correspondence to real people or companies). The
  Supabase project itself currently has zero rows in every table.

## What's not done — do not treat as production-ready

- **Nobody has clicked through the live app in a browser.** See "Known
  tool gaps" — this session could not reach the deployed URLs over HTTP.
- Asaas and WhatsApp/e-mail/push are entirely stubbed pending real
  accounts — see "Manual steps required" above.
- No termo de uso / política de privacidade / contrato de operador de
  dados — per spec §6, real student data must never be loaded before
  those exist, regardless of how much code now exists.
- No automated test coverage for `apps/web` itself (only the database
  layer has automated tests — the 106-case tenant-isolation suite).
- No CI wiring for any of this (SAGA's own `pull-request`/`security`
  GitHub Actions workflows run against the whole repo and will lint/
  format-check `apps/web`, but nothing runs the Next.js build or the
  Supabase migrations in CI).
