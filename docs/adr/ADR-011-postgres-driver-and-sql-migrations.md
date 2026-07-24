# ADR-011: node-postgres (pg) + reviewed SQL migrations with a checksum-enforced runner for Phase 0 (not Prisma)

- **Status:** ACCEPTED
- **Date:** 2026-07-22
- **Deciders:** Phase 0 engineering
- **Requirement IDs:** JK-SEC-004, JK-SEC-005 (RLS), JK-DOM-006/JK-CON-003
  (append-only triggers), §30.1 (technology baseline: "Prisma for common
  access plus reviewed SQL migrations"), §36 (migration ordering and
  checksum fitness function), Appendix B (reference SQL migration baseline
  and Migration Rules), Volume XIII deliverable 6
- **Related:** [ADR-012](ADR-012-rls-session-tenancy.md)

## Context

Spec §30.1 baselines "Prisma for common access plus reviewed SQL
migrations — developer productivity without hiding database design". But the
Phase 0 foundation is almost entirely the part Prisma abstracts _away_:

- Appendix B mandates SQL-first constructs as first-class artifacts: RLS
  policies with `current_setting('app.tenant_id')`, `FORCE ROW LEVEL
SECURITY`, partial unique indexes (`animal_identifier_active_unique`),
  composite same-tenant foreign keys, append-only enforcement triggers
  (`forbid_event_mutation`), PostGIS geometry columns, and guarded
  role grants. None of these are expressible in Prisma's schema language;
  all would live in raw-SQL escape hatches anyway.
- Appendix B "Migration Rules" requires immutable, checksummed, ordered
  migrations applied from zero and from the latest snapshot — a contract we
  must own and test directly (§36 fitness function).
- The Phase 0 data-access surface is small (event append, outbox relay,
  identity queries), and every tenant-scoped statement must run inside a
  transaction that has already executed `SET LOCAL app.tenant_id`
  (see [ADR-012](ADR-012-rls-session-tenancy.md)); a query builder adds no
  safety to that invariant, but an ORM connection pool that manages its own
  transactions could silently break it.

## Decision

Phase 0 uses **node-postgres (`pg`)** directly plus **hand-reviewed SQL
migrations** executed by our own **checksum-enforced runner**:

- Migrations: `database/migrations/0001..0004_*.sql` — reviewed SQL, ordered
  by numeric prefix, immutable after release.
- Runner: `packages/database/src/migrator.ts` — sha256 checksum per applied
  migration recorded in `schema_migration`; drift, missing files, duplicate
  ordinals, and out-of-order additions fail loudly; each migration applies
  in one transaction under an advisory lock; `verifyMigrations` re-checks
  the full set (used by `pnpm db:migrate:test`).
- Access: `packages/database/src/client.ts` (`createPool`,
  `withTenantTransaction`, `withSystemTransaction`) and
  `packages/database/src/event-store.ts` (`appendEvent`) — parameterized SQL
  only, no string interpolation.

**Prisma is not rejected permanently.** Per the §30.1 baseline it is
re-evaluated for _common access_ (CRUD-heavy Phase 1+ modules such as the
animal registry) once the foundation is stable — as a query layer on top of
these same reviewed SQL migrations, never as the migration authority, and
only if it can run inside `withTenantTransaction`-managed transactions
(interactive transactions / client extension), keeping RLS session tenancy
intact. That evaluation, if pursued, is a new ADR that references this one.

## Consequences

Easier:

- RLS, triggers, partial indexes, and PostGIS are first-class, reviewable
  diffs — the security-critical schema is exactly what is in git.
- The migration contract (§36, Appendix B rules) is fully owned and tested:
  `packages/database/tests/integration/migrator.integration.test.ts` covers
  clean-build from zero, idempotent re-run, checksum drift detection,
  out-of-order rejection, and the append-only trigger.
- No ORM version in the security-review surface; `pg` is a thin, audited
  driver.

Harder / given up:

- No generated types from the schema: row mappers are hand-written (e.g.
  `mapTenantRow` in `packages/identity-tenancy/src/domain.ts`) and must be
  kept in sync with migrations via integration tests.
- More SQL in application packages; repetitive CRUD will get tedious in
  Phase 1+ — which is precisely the trigger to re-run the Prisma evaluation.

## Verification

- `pnpm db:migrate:test` — apply + verify from zero against
  `TEST_DATABASE_URL` (`scripts/bootstrap/migrate.mjs --verify`).
- `packages/database/tests/integration/migrator.integration.test.ts` — the
  §36 "migration ordering and checksum" fitness function, executable.
- CI applies all migrations from zero on every PR
  (`.github/workflows/pull-request.yml` with a PostGIS service container).
