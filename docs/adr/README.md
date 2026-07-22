# Architecture Decision Records

Decision log for JK Platform, per **JK-PLT-EES-001 §93 (Open Architecture
Decisions)** and the CLAUDE.md rule: *stop and create a visible blocker/ADR
when an unresolved vendor, legal, cloud, identity, or model-provider decision
is required.*

ADR-001..ADR-010 mirror the ten open decisions in spec §93 exactly, in the
spec's order. They stay **OPEN** until the founder/engineering deciders close
them; while open, the repository must honor each ADR's *default until
decided* posture (and CI protects those defaults where possible).
ADR-011+ record decisions actually taken during implementation.

| ADR | Title | Status |
| --- | ----- | ------ |
| [ADR-000](ADR-000-template.md) | Template | — |
| [ADR-001](ADR-001-cloud-provider-and-region.md) | Cloud provider and primary region | OPEN |
| [ADR-002](ADR-002-managed-identity-provider.md) | Managed identity provider | OPEN |
| [ADR-003](ADR-003-kubernetes-vs-serverless.md) | Kubernetes vs managed serverless containers for first production | OPEN |
| [ADR-004](ADR-004-nats-jetstream-hosting.md) | NATS JetStream hosting model | OPEN |
| [ADR-005](ADR-005-mobile-distribution-and-mdm.md) | Mobile distribution and MDM | OPEN |
| [ADR-006](ADR-006-scale-rfid-vendors.md) | First physical scale/RFID vendors and protocols | OPEN |
| [ADR-007](ADR-007-accounting-integration.md) | Accounting system integration | OPEN |
| [ADR-008](ADR-008-ai-model-providers.md) | AI model providers and data residency | OPEN |
| [ADR-009](ADR-009-analytical-warehouse.md) | Long-term analytical warehouse | OPEN |
| [ADR-010](ADR-010-graph-database.md) | Dedicated graph database | OPEN |
| [ADR-011](ADR-011-postgres-driver-and-sql-migrations.md) | node-postgres + reviewed SQL migrations (not Prisma) for Phase 0 | ACCEPTED |
| [ADR-012](ADR-012-rls-session-tenancy.md) | RLS session tenancy: per-transaction `SET LOCAL app.tenant_id`, three-role model | ACCEPTED |

## Process

1. Copy [ADR-000-template.md](ADR-000-template.md) to the next free number.
2. Fill in requirement IDs — an ADR without requirement IDs is incomplete
   (spec §89: every deliverable is linked to requirement/ADR).
3. Open a PR; deciders approve; status changes to ACCEPTED/REJECTED.
4. Never edit an ACCEPTED ADR's decision retroactively — supersede it with a
   new ADR and cross-link both.
5. Update [docs/traceability/matrix.md](../traceability/matrix.md) in the
   same change.
