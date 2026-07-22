# JK Platform (SAGA)

**JK Platform** is an enterprise farm operating system for livestock
enterprises — immutable animal history, herd operations, genetics,
reproduction, health, pasture, inventory, finance, devices, analytics, and
explainable AI in one traceable, multi-tenant platform.

> Repository working name: **SAGA**. Canonical product name per the
> authoritative specification (**JK-PLT-EES-001**, v1.0) is **JK Platform**.

The first operational target is a Brangus farm (~100 ha, Lagoinha/Cunha,
São Paulo, Brazil) with two coordinated verticals: a **genetic nucleus**
(selection, reproduction, lineage, breeding sales) and a **beef operation**
(lot-based growth, grazing, health, cost, sale performance).

## Architecture at a glance

- **Monorepo**: pnpm workspaces (TypeScript, Node.js 22).
- **Backend**: modular monolith (NestJS + Fastify) with event-driven seams.
- **System of record**: PostgreSQL 16 + PostGIS; immutable domain-event
  ledger + transactional outbox; Row-Level Security for tenant isolation.
- **Messaging**: NATS JetStream (at-least-once; idempotent consumers).
- **Contracts**: OpenAPI (commands/integrations), GraphQL (composite reads),
  AsyncAPI + JSON Schema (events) — validated in CI.
- **Observability**: OpenTelemetry, structured logs, correlation IDs.
- **Offline-first**: mobile/edge store-and-forward with idempotent replay
  (arrives in later phases per the roadmap).

See `docs/architecture/` and the specification for the full design.

## Repository layout

```
apps/            Deployable workloads (api, worker; web/mobile/sync/edge/ai in later phases)
packages/        Domain modules and shared platform packages
contracts/       OpenAPI, GraphQL SDL, AsyncAPI, JSON Schemas
database/        SQL migrations, seeds, policies, verification
infrastructure/  Docker, Compose, Helm, Terraform, observability
docs/            Architecture, ADRs, domain, data dictionary, traceability
scripts/         Bootstrap, generate, validate, release, recovery
tests/           Cross-cutting test suites (e2e, contracts, security, ...)
```

## Getting started

Prerequisites: Node.js >= 22, pnpm >= 9, PostgreSQL 16 with PostGIS
(or Docker via `infrastructure/compose/`).

```bash
cp .env.example .env
pnpm install
pnpm build
pnpm db:migrate
pnpm db:seed              # synthetic reference farm
pnpm test:unit
pnpm test:integration     # needs TEST_DATABASE_URL (see .env.example)
pnpm --filter @jk/api start
curl http://localhost:4000/health/ready
```

One-command bootstrap: `pnpm bootstrap`.

## Engineering rules

The specification is a contract, not inspiration. Key invariants: tenant
isolation everywhere; append-only domain history (corrections supersede,
never overwrite); stable animal identity; idempotent ingestion;
at-least-once messaging; explainable, human-approved AI. See `CLAUDE.md`
and `docs/adr/` before contributing.

## Status

**Phase 0 — Foundation and Decision Closure** (Volume XII): monorepo,
tenancy + identity foundation, event ledger + outbox, RLS, contracts
pipeline, CI, observability baseline, synthetic seed, ADRs, traceability.
Later phases add the full functional scope (animal registry & weighing,
health, reproduction, pasture, inventory, finance, genetics, governed AI,
web/mobile/edge apps).
