# JK Platform (SAGA) — Project Summary

**JK Platform** is a multi-tenant, offline-capable ERP for cattle
agrobusiness, implemented against **JK-PLT-EES-001** (Enterprise Engineering
Specification v1.0). "SAGA" is the repository working name; "JK Platform" is
the product name. The reference operation is a Brangus genetic-nucleus + beef
farm (~100 ha, São Paulo, Brazil).

This document is the capstone map of what exists and how to run it. For
per-requirement traceability see [`docs/traceability/`](traceability/); for
deployment see [`docs/operations/deployment.md`](operations/deployment.md).

## At a glance

- **TypeScript monorepo** (pnpm workspaces, Node 22, strict ESM/NodeNext).
- **25 workspace packages** verified by the boundary checker
  (`pnpm architecture:check`) — 19 packages + 6 apps — plus a device simulator.
- **18 database migrations**, PostgreSQL 16 + PostGIS, Row-Level Security
  (FORCE) on every tenant table, an append-only domain-event ledger, and a
  transactional outbox.
- **Contracts** in `contracts/`: OpenAPI (REST), GraphQL, AsyncAPI (events),
  JSON Schema — validated in CI (`pnpm contracts:validate`).
- **52 test files** (unit + integration + tenant-isolation), ~140 traceability
  rows, ADRs 001–013 (ADR-001..010 are open vendor/cloud decisions).

## The eight non-negotiable invariants — where they live

1. **Tenant isolation everywhere** — `RLS … FORCE` with a fail-closed policy
   (`tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid`) on
   every tenant table; app role `jk_app` never sees across tenants. Enforced in
   `withTenantTransaction` (`@jk/database`); attacked by
   `pnpm test:tenant-isolation` and every package's suite.
2. **Append-only history** — the `domain_event` ledger + `forbid_event_mutation`
   trigger; corrections are compensating events. Audit ledgers
   (`ai_action_audit`, `webhook_delivery_attempt`, `export_access_log`,
   `financial_entry`) carry the same trigger.
3. **Stable animal identity** — `animal.id` is independent of lot, paddock,
   tag, or lifecycle status; identifiers (RFID/visual/official) are time-scoped
   assignments (`@jk/animal-registry`).
4. **Offline never loses observations** — `@jk/offline-sync` (durable outbox,
   at-least-once, idempotent, crash-safe, backoff); a captured observation
   leaves `pending` only on server accept or explicit reject.
5. **Idempotent, at-least-once** — client `Idempotency-Key` on every command,
   dedupe on the event idempotency key, transactional outbox relay.
6. **Governed AI** — recommendations are evidence-bound with confidence and
   provenance, high-impact actions require human approval, prohibited actions
   can never auto-execute, and a per-tenant kill switch disables generation
   (`@jk/analytics-intelligence` + `apps/ai-orchestrator`).
7. **No secrets in the repo/fixtures** — typed config fails startup on invalid
   critical values; synthetic pt-BR seed data only; structured logs never emit
   headers/tokens/bodies.
8. **A feature is complete only with** tests, contracts, migrations,
   observability, docs, and traceability — enforced per slice.

## Architecture

### Bounded-context (feature) packages

| package                      | context                                                                |
| ---------------------------- | ---------------------------------------------------------------------- |
| `@jk/identity-tenancy`       | tenants, farms, users, memberships, RLS onboarding                     |
| `@jk/animal-registry`        | animal identity, identifiers, timeline                                 |
| `@jk/herd-operations`        | weighing/handling sessions, lots, paddock movements                    |
| `@jk/health-laboratory`      | protocols, treatments, withdrawal → sale-clear block                   |
| `@jk/reproduction-genetics`  | service → pregnancy → calving, DEP/EBV, selection index                |
| `@jk/land-grazing`           | paddocks, grazing occupation, pasture assessment (kg/ha)               |
| `@jk/nutrition-inventory`    | item master, stock ledger, batches, expiry                             |
| `@jk/finance-commerce`       | expenses/revenue/allocation, sales, margin, budgets                    |
| `@jk/assets-maintenance`     | assets, schedules, calibration, work orders                            |
| `@jk/analytics-intelligence` | alerts, reports, Farm Intelligence Index, governed AI, exports, search |
| `@jk/automation-integration` | connector framework + tenant webhooks                                  |
| `@jk/data-import`            | staged CSV import (upload→…→reconcile)                                 |

Feature packages never import each other — cross-context collaboration is via
application ports (the API composition root) or domain events.

### Shared technical packages

`@jk/domain-kernel` (event envelope, Money, Measurement, tenant context,
errors, config), `@jk/database` (migrator, RLS client, event store/outbox),
`@jk/observability`, `@jk/contracts-rest` (typed client), `@jk/offline-sync`,
`@jk/sync-http`, `@jk/testkit`.

### Applications

| app                    | role                                                              |
| ---------------------- | ----------------------------------------------------------------- |
| `apps/api`             | Fastify REST API over all contexts; auth, RFC 9457, CORS          |
| `apps/worker`          | transactional-outbox relay + projections                          |
| `apps/web`             | React/Vite console — 14 screens over the whole surface            |
| `apps/mobile`          | React Native field app (offline-first) on `@jk/offline-sync`      |
| `apps/edge-gateway`    | on-farm durable device ingestion + upstream batch sync            |
| `apps/ai-orchestrator` | governed AI runtime (tools, policy guard, deterministic provider) |

## Mandatory scenarios proven (executable)

- **500-observation disconnect/replay** (offline never loses) —
  `packages/offline-sync/tests/sync.test.ts` and the device simulator.
- **Medicine withdrawal blocks sale clearance (#8)** and the **animal
  traceability packet** (JK-ANI-006), end-to-end through the HTTP API —
  `apps/api/tests/integration/e2e-scenario.integration.test.ts`.
- **Service → pregnancy → calving → calf pedigree** —
  `packages/reproduction-genetics/tests/`.
- **Governed AI: evidence + prohibited-action block + kill switch** —
  `packages/analytics-intelligence/tests/integration/recommendations.integration.test.ts`
  and `apps/ai-orchestrator/tests/` (a rogue provider proposing euthanasia is
  blocked; nothing prohibited is ever written).

## How to run

```bash
pnpm install
pnpm build && pnpm typecheck && pnpm lint     # workspace gates
pnpm architecture:check                        # module boundaries
pnpm contracts:validate                        # OpenAPI/GraphQL/AsyncAPI

# Tests (integration needs PostgreSQL):
pnpm test:unit
TEST_DATABASE_ADMIN_URL=postgresql://jk:jk@localhost:5432/postgres pnpm test:integration
pnpm test:tenant-isolation

# Whole stack, seeded, in one command (Docker):
scripts/dev/stack-up.sh
#   web → :8080  api → :4000  worker → :4100  edge → :4200  ai → :4300
#   sign in with seed owner 00000000-0000-4000-8000-000000000021
#            tenant       00000000-0000-4000-8000-000000000001
```

## Open decisions & deferred work

Ten vendor/cloud decisions are tracked as ADRs (`docs/adr/`, ADR-001..010).
The most load-bearing still open:

- **ADR-008 (AI model providers)** — the orchestrator is built
  provider-abstract with a deterministic default; an LLM provider drops into
  the same interface when this closes.
- **ADR-002 (identity provider)**, **ADR-001 (cloud/region)**,
  **ADR-006 (scale/RFID vendors)**, **ADR-007 (accounting integration)**.

Deferred (named, not silently assumed): at-rest encryption for export
artifacts is the storage layer's responsibility (object-store SSE); the RN
`ui/` layer compiles with the React Native toolchain (its device glue is
tested in Node); dashboards/SLO alerting are provisioned but not yet wired.
See [`docs/operations/production-hardening.md`](operations/production-hardening.md).
