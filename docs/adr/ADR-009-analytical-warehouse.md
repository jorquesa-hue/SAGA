# ADR-009: Long-term analytical warehouse

- **Status:** OPEN
- **Date:** 2026-07-22 (opened; not yet decided)
- **Deciders:** engineering lead (pending; scale-triggered)
- **Requirement IDs:** §35 (analytics on read-only replicas/warehouse as
  scale requires), §42 (read models and analytics stores), §79 (capacity
  baseline)
- **Related:** [ADR-001](ADR-001-cloud-provider-and-region.md),
  [ADR-010](ADR-010-graph-database.md)

## Context

Dashboards, KPIs (§59), and Farm Intelligence analytics could eventually
outgrow operational PostgreSQL. Candidates when that happens: a columnar
warehouse (BigQuery/Redshift/Snowflake/ClickHouse) fed by the event ledger.
Today the platform has exactly one analytics store: PostgreSQL projections
rebuilt from `domain_event` (Phase 0 example:
`projection_event_stats` in `database/migrations/0004_worker_projections.sql`,
maintained by `apps/worker/src/projector.ts`).

## Decision

OPEN. **Default until decided (spec §93, verbatim):** *"PostgreSQL
projections initially; warehouse triggered by scale/use case."*

The repository honors the default today: projections are ordinary
tenant-scoped Postgres tables with `calculated_at` (§42), rebuildable from
the immutable ledger, so a warehouse can be fed later by replaying
`domain_event` without schema surgery.

**Decision criteria (triggers, not preferences):**

1. Projection query latency breaching §32.2 (dashboard p95 < 3 s cached) at
   §79 reference volume (1M events/tenant).
2. Analytical workloads measurably degrading operational transactions
   (§35 forbids commands against analytical stores — pressure appears first
   as replica need).
3. Cross-tenant platform analytics needs that must not touch operational RLS
   paths.
4. Cost of warehouse + pipeline vs bigger Postgres/replicas.

## Consequences

Blocked/deferred until triggered:

- Any ELT pipeline, warehouse Terraform, and warehouse-side tenant-isolation
  design (isolation obligations follow the data — §67 applies to exports and
  analytics stores explicitly).

Consequence of the default: analytics stay transactionally fresh and
RLS-protected; some heavy aggregations will be pre-computed by workers
instead of ad-hoc queried.

## Verification

`apps/worker/tests/integration/projector.integration.test.ts` proves
projections are idempotent, rebuild-safe, and RLS-scoped — the properties
that keep the warehouse door open.
