# JK Platform Engineering Directive

You are implementing JK Platform against **JK-PLT-EES-001** (Enterprise
Engineering Specification v1.0). Treat the specification as normative.
The repository working name is **SAGA**; the canonical product name is
**JK Platform** (see spec §92 — "JK Software" is a historical alias only).

## Non-negotiable invariants

1. Tenant isolation is mandatory on every path, job, cache, file, event,
   search, export, and AI tool.
2. Domain history is append-only. Corrections create explicit
   compensating/superseding events.
3. Animal identity is stable and independent of lot, paddock, tag, or
   lifecycle status.
4. Offline critical workflows must never silently lose observations.
5. Device and external retries are idempotent; messaging is at-least-once.
6. AI recommendations need evidence, uncertainty, audit, and approval for
   high-impact actions.
7. No secret, production credential, or personal data is committed or placed
   in fixtures.
8. A feature is incomplete without tests, contracts, migrations,
   observability, documentation, and traceability.

## Required implementation behavior

- Work in vertical slices.
- Read relevant requirement IDs and ADRs before editing.
- Update the traceability matrix (`docs/traceability/`) with every change.
- Add or update executable tests first for domain rules and regressions.
- Generate OpenAPI, GraphQL, AsyncAPI, JSON Schema, and typed clients
  deterministically (`contracts/`, `pnpm contracts:validate`).
- Use PostgreSQL transactions and the transactional outbox for accepted
  domain events.
- Keep module boundaries; do not write another module's tables directly
  (`pnpm architecture:check`).
- Validate all external input. Preserve raw device/import evidence.
- Use typed configuration and fail startup on invalid critical configuration.
- Emit structured logs/traces with correlation IDs and no secrets.
- Stop and create a visible blocker/ADR when an unresolved vendor, legal,
  cloud, identity, or model-provider decision is required
  (see `docs/adr/` — ADR-001..ADR-010 are open decisions).

## Repository commands

```bash
pnpm install                # install workspace
pnpm build                  # build all packages/apps
pnpm typecheck              # typecheck all
pnpm lint                   # eslint
pnpm test:unit              # unit tests (no external services)
pnpm test:integration       # requires PostgreSQL (TEST_DATABASE_URL)
pnpm test:tenant-isolation  # cross-tenant attack suite (requires PostgreSQL)
pnpm db:migrate             # apply database/migrations to DATABASE_URL
pnpm db:migrate:test        # apply + verify from zero against TEST_DATABASE_URL
pnpm db:seed                # synthetic reference farm seed (never production data)
pnpm contracts:validate     # OpenAPI/GraphQL/AsyncAPI validation
pnpm architecture:check     # package dependency boundary enforcement
```

Local services (PostgreSQL 16 + PostGIS, Redis, NATS, MinIO, Keycloak, OTel
collector) are defined in `infrastructure/compose/docker-compose.yml`.

## Current implementation status

Phase 0 (Foundation and Decision Closure) is in progress. Later phases
(Volume XII) add animal registry & weighing (Phase 1), health/reproduction
(Phase 2), pasture/inventory/assets (Phase 3), finance/genetics (Phase 4),
governed AI (Phase 5), plus the web, mobile, sync, edge-gateway, and
ai-orchestrator apps. Do not create placeholder-only modules: every created
service must build, start, expose health endpoints, emit structured
telemetry, and have automated tests.

## Completion response for each task

Report:

1. requirement IDs implemented;
2. files changed;
3. migrations/contracts generated;
4. tests run and results;
5. security/tenancy considerations;
6. remaining blockers or ADRs.
