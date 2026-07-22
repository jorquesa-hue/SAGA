# ADR-010: Dedicated graph database

- **Status:** OPEN
- **Date:** 2026-07-22 (opened; not yet decided)
- **Deciders:** engineering lead (pending; use-case triggered)
- **Requirement IDs:** §41 (Farm Knowledge Graph), JK-CON-004 (typed
  temporal relationships), §12 (pedigree)
- **Related:** [ADR-009](ADR-009-analytical-warehouse.md)

## Context

The Farm Knowledge Graph (§41) — animals, people, paddocks, assets,
documents, transactions connected by typed temporal links (JK-CON-004) —
could be served by a dedicated graph database (Neo4j, Neptune, etc.).
The relational model already carries the graph: every relationship in the
core ERD is a typed, temporal foreign-key row (e.g. `animal_identifier`
validity ranges, `tenant_membership`/`farm_membership` `valid_from/valid_to`
in `database/migrations/0002_identity_and_membership.sql`), and pedigree
(Phase 4) is a self-referencing relation with recursive CTE traversal.

## Decision

OPEN. **Default until decided (spec §93, verbatim):** *"Not adopted
initially."*

The repository honors the default today: no graph database appears in any
manifest, compose service, or Terraform module; graph-shaped queries are
PostgreSQL queries over tenant-scoped relations.

**Decision criteria (triggers):**

1. A concrete product feature whose traversal depth/fan-out makes recursive
   CTEs measurably inadequate (e.g. multi-generation pedigree analytics at
   §79 scale, knowledge-graph-backed AI retrieval in Phase 5).
2. Proven inability to satisfy the query with projections
   ([ADR-009](ADR-009-analytical-warehouse.md) path first).
3. Tenant-isolation story for the graph store equivalent to RLS (§67 — a
   second store means a second isolation implementation and attack suite).
4. Operational cost for a small team (§94).

## Consequences

Consequence of the default: one authoritative store, one isolation model,
one backup/restore procedure
([docs/operations/runbook-backup-restore.md](../operations/runbook-backup-restore.md)).
Deep traversals pay recursive-CTE cost; if that cost ever violates a KPI
SLO, this ADR gets a decision proposal with benchmarks.

## Verification

Absence is the verification: no graph-store dependency in `pnpm-lock.yaml`,
`infrastructure/compose/docker-compose.yml`, or
`infrastructure/terraform/`.
