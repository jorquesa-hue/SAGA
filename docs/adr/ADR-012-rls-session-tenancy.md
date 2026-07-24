# ADR-012: RLS session tenancy — per-transaction `SET LOCAL app.tenant_id`, fail-closed policies, three-role model

- **Status:** ACCEPTED
- **Date:** 2026-07-22
- **Deciders:** Phase 0 engineering
- **Requirement IDs:** JK-DOM-001, JK-SEC-004, JK-SEC-005, JK-IAM-006, §67
  (tenant isolation), §31.2 (worker delivery), Appendix B (RLS baseline)
- **Related:** [ADR-011](ADR-011-postgres-driver-and-sql-migrations.md),
  [docs/security/threat-model.md](../security/threat-model.md)

## Context

§67 requires database connection context to set tenant variables for RLS,
beneath mandatory application-level tenant checks (JK-SEC-004: server-side
tenant resolution; JK-SEC-005: RLS as defense in depth). Appendix B's
baseline policy uses `current_setting('app.tenant_id', true)::uuid`. Three
hazards had to be engineered out:

1. **Pooled-connection leakage** — a session-level `SET` survives
   `pool.release()` and would bleed one request's tenant into the next.
2. **The empty-string hole** — `current_setting(..., true)` returns `''`
   (not NULL) for an unset GUC in some paths; a naive `::uuid` cast raises
   an error at best, and naive comparisons can behave surprisingly. The
   policy must fail **closed** (zero rows), not fail loud-or-open.
3. **Cross-tenant workers** — the outbox relay/projector legitimately reads
   all tenants' outbox rows. `BYPASSRLS` would be a standing skeleton key.

## Decision

### 1. Per-transaction `SET LOCAL` via parameterized `set_config`

`withTenantTransaction` (`packages/database/src/client.ts`) is the **only**
approved path to tenant-scoped data. It requires an explicit `TenantContext`
(`packages/domain-kernel/src/tenant-context.ts` — a frozen object carrying
tenantId + actor + correlationId, never a bare string), throws
`TenantIsolationError` when missing, and inside `BEGIN` executes:

```sql
SELECT set_config('app.tenant_id', $1, true)  -- true => SET LOCAL semantics
```

The value is bound as a parameter (never interpolated), and the `true`
argument scopes it to the transaction — it cannot leak across pooled
connections.

### 2. Fail-closed policies with the NULLIF empty-string guard

Every tenant-scoped policy in `database/migrations/0001..0004` compares
against:

```sql
NULLIF(current_setting('app.tenant_id', true), '')::uuid
```

Unset or empty GUC → `NULL` → the `tenant_id = NULL` predicate is not true
for any row → **zero rows visible, zero rows insertable** (`WITH CHECK`
uses the same expression). No error channel, no data channel: fail closed.
Additionally every RLS-bearing table sets `FORCE ROW LEVEL SECURITY`, so
even the table owner is subject to policies (superusers still bypass; the
application never connects as one).

### 3. Three-role model instead of BYPASSRLS

Provisioned by `database/policies/application_roles.sql` (local/CI;
infrastructure-provisioned with strong credentials in staging/production):

| Role                       | Used by                                                                                                   | Powers                                                                                                                                                                             |
| -------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| owner/admin (`jk` locally) | migrations (`scripts/bootstrap/migrate.mjs`), test harness, tenant onboarding via `withSystemTransaction` | DDL; still subject to FORCE RLS on owned tables outside superuser                                                                                                                  |
| `jk_app`                   | API / application services via `withTenantTransaction`                                                    | tenant-scoped DML only, RLS-enforced; read-only on projections                                                                                                                     |
| `jk_worker`                | `apps/worker` outbox relay + projector                                                                    | cross-tenant via **scoped policies** (`outbox_worker_policy`, `domain_event_worker_read`, `processed_message_worker_policy`, ...), _no_ grants on business tables, never BYPASSRLS |

`withSystemTransaction` (no tenant GUC) exists for platform-level operations
only — tenant onboarding, where no tenant exists yet
(`packages/identity-tenancy/src/identity-service.ts` documents the two-path
design); each use site is audit-reviewed.

## Consequences

- Application bugs that forget tenant scoping return empty results instead
  of foreign data; deliberate cross-tenant writes die on `WITH CHECK`.
- Every new tenant-scoped table MUST ship in its migration: `ENABLE` +
  `FORCE ROW LEVEL SECURITY`, the NULLIF-guarded policy pair, and guarded
  grants — reviewers treat a missing policy as a blocking defect (see the
  checklist in [docs/security/threat-model.md](../security/threat-model.md)).
- Workers must never receive `jk_app` credentials or vice versa
  (JK-IAM-006); compose wires this correctly
  (`infrastructure/compose/docker-compose.yml`: `DATABASE_URL` uses
  `jk_app`, `WORKER_DATABASE_URL` uses `jk_worker`).
- Long-lived transactions hold the GUC for their duration; keep transactions
  short (already required by outbox latency goals).

## Verification (executable)

- `packages/database/tests/integration/rls-event-store.integration.test.ts`:
  - "app role sees only the active tenant's rows (JK-SEC-004/005)"
  - "blocks cross-tenant INSERT even when application code lies (RLS WITH CHECK)"
  - "app role without tenant context sees nothing (fail-closed)"
  - "worker role reads the outbox across tenants but app role cannot"
  - "worker role cannot touch business tables (least privilege, JK-IAM-006)"
- `packages/identity-tenancy/tests/integration/identity-service.integration.test.ts`:
  forged-context, wrong-tenant-read, and cross-tenant-write attack cases.
- `apps/worker/tests/integration/projector.integration.test.ts`:
  "jk_app under tenant B cannot read tenant A stats (RLS, JK-SEC-004/005)".
- The dedicated cross-tenant attack suite aggregates these paths under
  `pnpm test:tenant-isolation` (`@jk/testkit`, §83).
