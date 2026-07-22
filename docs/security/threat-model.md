# Threat Model — Phase 0 baseline

STRIDE-lite over the Phase 0 attack surfaces (API, database, worker, CI,
secrets). Expanded per §65 as later phases add mobile, edge, files, and AI.

## Surfaces & assets

| Surface | Key assets |
|---|---|
| API (`apps/api`) | tenant data, auth tokens, correlation of actions |
| PostgreSQL | domain event ledger, tenancy, audit, memberships |
| Worker (`apps/worker`) | cross-tenant outbox stream |
| CI/CD | build integrity, secrets, dependency provenance |
| Secrets/config | DB credentials, OIDC config |

## STRIDE

| Threat | Vector | Mitigation | Status |
|---|---|---|---|
| **Spoofing** | forged identity / tenant | OIDC JWT verify (issuer+audience); actor id from token never body; dev auth impossible outside local | implemented (ADR-002 provider open) |
| **Tampering** | mutate history | append-only `domain_event`/`audit_record` triggers; corrections via superseding events | implemented |
| **Repudiation** | deny an action | audit stream with actor/correlation/outcome; denials audited with reason | implemented |
| **Information disclosure** | cross-tenant read | RLS FORCE + fail-closed policies; app-level authorization; isolation attack suite (10 tests) | implemented |
| **Denial of service** | expensive queries / floods | body limit; indexed timeline; (rate limiting via ingress — infra ADR) | partial |
| **Elevation of privilege** | act beyond role | central authorization policy with explicit reasons; least-privilege DB roles; worker cannot read business tables | implemented |

## §65.1 requirement status (Phase 0)

| ID | Requirement | Status |
|---|---|---|
| JK-SEC-001 | TLS everywhere; mTLS device | infra (ADR); not in code |
| JK-SEC-002 | encryption at rest; secret manager | infra/env; `.env.example` never holds real secrets |
| JK-SEC-003 | MFA for privileged roles | IdP responsibility (ADR-002) |
| JK-SEC-004 | server-side tenant + authz before access | **implemented** |
| JK-SEC-005 | RLS defense in depth | **implemented** |
| JK-SEC-006 | no secrets in logs | **implemented** (redaction) |
| JK-SEC-007 | file scan + short-lived URLs | planned (files phase) |
| JK-SEC-009 | tamper-evident audit | **implemented** |
| JK-SEC-010 | CI scans (deps/containers/IaC/source) | **implemented** (workflow) |

## §67 tenant isolation checklist → tests

| Control | Test |
|---|---|
| tenant_id non-null on roots | migrations; isolation suite |
| repositories require tenant context | `withTenantTransaction` requires `TenantContext` |
| DB session sets tenant var (RLS) | `packages/database/tests/integration/rls-event-store.integration.test.ts` |
| jobs/consumers verify envelope tenant | `assertSameTenant`; worker projector |
| cross-tenant tests in CI | `packages/testkit/tests/tenant-isolation/isolation.attack.test.ts` |

## Residual risks / follow-ups

- OIDC provider + MFA policy (ADR-002); cloud KMS + secret manager (ADR-001).
- `app.tenant_id` trust boundary: set server-side only (documented ADR-012);
  never derived from client input beyond a membership-validated selector.
- Penetration test before material production launch (§83).
