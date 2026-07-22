# Traceability Matrix — Phase 0

Maps requirement IDs (JK-PLT-EES-001) to design area, implementing source, and
verifying tests. Status is truthful: **implemented** (code + passing tests in
this repo), **partial** (some aspects implemented, others deferred), or
**planned** (later phase per Volume XII). Machine-readable copy: `matrix.csv`.

Generated for the Phase 0 baseline (foundation and decision closure).

## Constitution & domain invariants

| Requirement | Design area | Source | Verification | Status |
|---|---|---|---|---|
| JK-CON-003 immutable history | event ledger / corrections | `database/migrations/0001` (`forbid_event_mutation` trigger); `@jk/domain-kernel` envelope `supersedesEventId` | `packages/database/tests/integration/migrator.integration.test.ts` (append-only), `event-envelope.test.ts` | implemented |
| JK-CON-008 offline continuity | mobile / sync / edge | — | — | planned (Phase 1-2) |
| JK-DOM-001 every record has a tenant | schema + RLS | migrations 0001-0004 (`tenant_id NOT NULL`, RLS FORCE) | tenant-isolation suite | implemented |
| JK-DOM-002 immutable UUID + human id | animal schema | `database/migrations/0001` (`animal`, `animal_identifier`) | seed + schema tests | partial (registry service in Phase 1) |
| JK-DOM-003 RFID unique among active | animal identifiers | `0001` `animal_identifier_active_unique` partial index | seed loads 15 active RFIDs | implemented (constraint) |
| JK-DOM-004 identity independent of lot/paddock | schema design | separate `animal` / (future) `lot_membership` | — | partial |
| JK-DOM-005 event has occurred/recorded/actor/tenant/idempotency | event envelope | `@jk/domain-kernel/event-envelope.ts`, `@jk/database/event-store.ts` | `event-envelope.test.ts`, `rls-event-store.integration.test.ts` | implemented |
| JK-DOM-006 events not updated/deleted | ledger trigger | `0001` `domain_event_no_update` | migrator integration test (UPDATE/DELETE rejected) | implemented |
| JK-DOM-007 quantity value + canonical unit | measurement VO | `@jk/domain-kernel/measurement.ts` | `measurement.test.ts` | implemented |
| JK-DOM-008 money: currency + amount + basis | money VO | `@jk/domain-kernel/money.ts` | `money.test.ts` | implemented |
| JK-DOM-009 device obs raw preserved | ingestion | — | — | planned (Phase 1) |
| JK-DOM-010 deceased/sold stay queryable | lifecycle status | `animal.lifecycle_status` CHECK | schema | partial |
| JK-DOM-011 withdrawal → restriction | health | — | — | planned (Phase 2) |
| JK-DOM-012 high-impact AI stays proposal | governed AI | — | — | planned (Phase 5) |

## Identity, tenancy, access (§17, §66-§68)

| Requirement | Design area | Source | Verification | Status |
|---|---|---|---|---|
| JK-IAM-001 multi-tenant, multi-farm, farm-scoped membership | identity-tenancy | `@jk/identity-tenancy` service + migrations 0001-0002 | `identity-service.integration.test.ts` | implemented |
| JK-IAM-002 OIDC/OAuth 2.1 auth | API auth | `apps/api/src/auth.ts` (jose JWT verify + dev fallback) | `api.integration.test.ts` (401 path) | partial (skeleton; provider ADR-002) |
| JK-IAM-003 role + attribute authorization | authorization policy | `@jk/identity-tenancy/authorization.ts` | `authorization.test.ts`, isolation suite | implemented |
| JK-IAM-004 privileged support access time-bound/audited | admin | — | — | planned |
| JK-IAM-005 deactivate without deleting authorship | membership lifecycle | `revokeMembership` (sets `valid_to`, never deletes) | `identity-service.integration.test.ts` | implemented |
| JK-IAM-006 service accounts least privilege | DB roles | `database/policies/application_roles.sql`, `jk_worker` scoped grants | isolation suite (worker cannot touch business tables) | implemented |

## Security (§65-§68)

| Requirement | Design area | Source | Verification | Status |
|---|---|---|---|---|
| JK-SEC-004 server-side tenant resolution + authz before access | API + services | `apps/api/src/request-context.ts`, service `authorized()` | isolation suite, `api.integration.test.ts` | implemented |
| JK-SEC-005 RLS defense in depth | migrations | RLS FORCE + policies (all tenant tables) | tenant-isolation suite | implemented |
| JK-SEC-006 no secrets in logs | observability | `@jk/observability/logger.ts` redaction | `observability.test.ts` | implemented |
| JK-SEC-009 tamper-evident audit for privileged actions | audit stream | `audit_record` (append-only trigger), service writes | `identity-service.integration.test.ts` (denials audited) | implemented |
| JK-SEC-001/002/007/010 TLS, encryption, file scan, CI scans | infra / CI | `infrastructure/`, `.github/workflows/security.yml` | workflow (structural) | partial (infra ADRs) |

## Architecture fitness functions (§36)

| Requirement | Source | Verification | Status |
|---|---|---|---|
| dependency boundaries between packages | `scripts/validate/architecture-check.mjs` | `pnpm architecture:check` (CI) | implemented |
| API/event schema validation | `scripts/validate/contracts-validate.mjs`, `contracts/` | `pnpm contracts:validate` (CI) | implemented |
| migration ordering + checksum | `@jk/database/migrator.ts` | migrator integration tests | implemented |
| tenant predicate present / cross-tenant tests | `@jk/testkit` isolation suite | `pnpm test:tenant-isolation` (CI) | implemented |
| no secrets / prohibited licenses | `.github/workflows/security.yml` | CI (gitleaks, dependency-review) | implemented (workflow) |
| contract compatibility | `.github/workflows/contract-compatibility.yml`, `scripts/validate/openapi-compat.mjs` | CI | implemented (workflow) |

## Mandatory deliverables (Volume XIII)

| # | Deliverable | Path | Status |
|---|---|---|---|
| 1 | Source code monorepo | `packages/`, `apps/` | implemented (Phase 0 scope) |
| 3 | OpenAPI | `contracts/openapi/jk-platform.yaml` | implemented |
| 4 | GraphQL schema | `contracts/graphql/schema.graphql` | implemented |
| 5 | AsyncAPI / event schemas | `contracts/asyncapi/`, `contracts/json-schema/` | implemented |
| 6 | SQL migrations | `database/migrations/0001-0004` | implemented |
| 7 | Docker manifests | `infrastructure/docker/`, `infrastructure/compose/` | implemented (unvalidated: no docker in env) |
| 8 | Kubernetes manifests | `infrastructure/helm/jk-api/` | implemented (unvalidated) |
| 9 | CI/CD pipelines | `.github/workflows/` | implemented (structural) |
| 10 | Terraform | `infrastructure/terraform/` | partial (provider ADR-001) |
| 13 | Backend services | `apps/api`, `apps/worker`, `packages/*` | implemented (Phase 0 scope) |
| 16 | Automated tests | package `tests/` suites | implemented (147 tests) |
| 17 | Operational documentation | `docs/operations/` | implemented |
| 19 | Data dictionary + traceability | `docs/data-dictionary/`, this file | implemented |
| 20 | Security & supply-chain evidence | `docs/security/threat-model.md`, `.github/workflows/security.yml` | partial |
| 2,11,12,14,15,18 | diagrams(partial), web, mobile, edge, AI, user docs | — | planned (later phases) |

## No orphan P0 requirement

Every P0 capability in the §16 map that Phase 0 targets (tenant/farm/user
administration; the identity/event/tenancy foundation the other P0 capabilities
build on) has implementing source and passing tests above. P0 capabilities
whose functional slice is scheduled later (animal registry, weighing, lots,
health, reproduction, offline sync, dashboards) are marked planned with their
target phase and are not claimed as done.
