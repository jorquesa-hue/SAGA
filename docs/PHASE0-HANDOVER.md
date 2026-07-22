# Phase 0 Handover — Status and Remaining Work

> Working state as of 2026-07-22. Spec: **JK-PLT-EES-001 v1.0** (authoritative).
> Read `CLAUDE.md` first. This file is the entry point for any engineer or
> AI session continuing the build.

## ✅ Done, verified, and pushed

| Area | Contents | Evidence |
|---|---|---|
| Monorepo | pnpm workspaces, strict TS (NodeNext ESM), ESLint/Prettier, root scripts | `pnpm build` clean |
| `@jk/domain-kernel` | §39 event envelope + zod, TenantContext, Money (bigint-exact, lossless allocate), Measurement (metric canonical, lb/arroba/acre), temporal validity, error taxonomy, typed config loader | 32 unit tests |
| Migrations 0001–0004 | Appendix B baseline + identity/membership + paddock (PostGIS) + worker projections; append-only triggers; **RLS FORCE with NULLIF pattern on every tenant table**; 3-role model (owner / `jk_app` / `jk_worker`) | 12 integration tests |
| `@jk/database` | Checksum-enforced migration runner (drift & out-of-order rejection), `withTenantTransaction` (SET LOCAL app.tenant_id), idempotent `appendEvent` + transactional outbox, §49 subject builder | same suite |
| `@jk/identity-tenancy` | IdentityService: createTenant/createFarm/inviteUser/activate/revokeMembership; AuthorizationPolicy with decision reasons (§66); denied ops audited; 5 canonical `identity.*.v1` events; JK-IAM-001/003/005 | 20 unit + 17 integration tests |
| `@jk/worker` | Outbox relay (FOR UPDATE SKIP LOCKED, per-message SAVEPOINT), publishers (InMemory/Log/NATS JetStream w/ msgID dedupe), idempotent EventStatsProjector (processed_message dedupe + tenant assertion), health HTTP server, graceful shutdown | 9 unit + 11 integration tests |
| `contracts/` | OpenAPI 3.1 (identity + Appendix C animal/device baseline), GraphQL SDL (Appendix D), AsyncAPI 3.0 (Appendix E + identity events), envelope + payload JSON Schemas, examples | `pnpm contracts:validate` → 9 docs OK |
| `infrastructure/` | Dockerfiles (api/worker), Compose stack (PG+PostGIS/Redis/NATS/MinIO/Keycloak/OTel), Helm chart `jk-api`, provider-neutral Terraform module contract, otel-collector config | YAML-validated (no docker/helm/tf binaries in env) |
| `.github/` | pull-request.yml (full gate incl. tenant-isolation), security.yml, contract-compatibility.yml (+ `scripts/validate/openapi-compat.mjs`), release.yml, deploy.yml, CODEOWNERS, dependabot, PR template | YAML-validated |
| Gates | `pnpm architecture:check` (boundary rules §35/Appendix F), `pnpm contracts:validate` | both green |

Local dev database: PostgreSQL 16 + PostGIS with roles from
`database/policies/application_roles.sql`. Run `pnpm bootstrap`.

## ⚠️ Known deviations / notes (from implementation reports)

1. **RLS upsert trap**: under `jk_app`, `INSERT ... ON CONFLICT`/`RETURNING` on
   `user_account` evaluates the SELECT policy against new rows (no membership
   yet → fails). Identity service uses app-generated UUIDs + plain INSERT with
   23505→ConflictError mapping. **Do not refactor back to upserts.**
2. Cross-tenant user linking (email exists in another tenant) is intentionally
   rejected; needs a future platform-level flow.
3. `pg` driver + SQL-first migrations chosen over Prisma for Phase 0
   (ADR-011 to be written; spec §30.1 lists Prisma as baseline — revisit).
4. Worker uses its own JSON-line logger; `@jk/observability` (OTel + pino)
   was descoped mid-build (spend limit) and must be recreated.
5. `test:tenant-isolation` root script targets `@jk/testkit` which does not
   exist yet (see below) — CI's tenant-isolation step will no-op until then.

## 🔲 Remaining Phase 0 work (in priority order)

1. **`packages/testkit` + tenant-isolation attack suite** *(Phase 0 exit gate,
   §67/§81.10)* — reusable disposable-DB harness + suite attacking every
   interface (SQL/RLS, identity services, event store, projections) from a
   second tenant; wire `pnpm test:tenant-isolation`.
2. **`apps/api`** (NestJS + Fastify, §45–§47): health probes, typed config,
   OIDC JWT skeleton (jose) + local dev fallback, TenantContext middleware
   (tenant from validated membership, never client-chosen), Idempotency-Key
   enforcement, RFC 9457 Problem Details filter, endpoints per
   `contracts/openapi/jk-platform.yaml` (tenants/farms/invitations/users),
   integration tests incl. cross-tenant 403s. Serve the authored OpenAPI file.
3. **`packages/observability`**: pino logger with redaction + OTel API
   baseline; adopt in api/worker (correlation IDs end-to-end, §77).
4. **`database/seeds` reference farm** (§6): idempotent synthetic seed —
   tenant, ~100 ha farm, 12 paddocks (PostGIS polygons), 6 role users,
   15 Brangus animals + RFID identifiers, one worked event+outbox example;
   `scripts/bootstrap/seed.mjs` (root script `db:seed` already points there).
5. **`docs/` completion**: ADR-000 template; ADR-001..010 (open decisions,
   §93 defaults); ADR-011 (pg driver), ADR-012 (RLS session tenancy);
   architecture C4 docs; data dictionary from migrations; traceability
   matrix (`docs/traceability/matrix.{md,csv}` — Appendix K format);
   operations runbooks; threat-model baseline (§65).
6. **Phase 0 exit review** against Volume XII exit criteria, then tag.

## ▶️ Phase 1 preview (next after Phase 0, Volume XII)

Animal registry & identifiers (JK-ANI-*), handling sessions & weighing
(JK-WGT-*), device-observation ingestion pipeline (Appendix C batch API),
scale/RFID simulator, animal timeline projection, first dashboard reads.

## How to continue (any model/session)

```bash
pnpm install && pnpm build && pnpm test:unit
pnpm db:migrate && pnpm test:integration   # needs local PostgreSQL 16 + PostGIS
```

Work in vertical slices; follow `CLAUDE.md`; keep every green gate green;
update the traceability matrix with each slice.
