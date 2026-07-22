# JK Platform Contracts

Authored, machine-readable API and event contracts for JK Platform
(JK-PLT-EES-001, Volume VI §45–§52; Appendices C, D, E). These documents are
the **source of truth** for every external surface — REST, GraphQL, and
domain events. Implementations conform to the contract, never the other way
around.

## Layout

| Path                          | Contract                                                                                                     | Spec reference      |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------- |
| `openapi/jk-platform.yaml`    | REST/OpenAPI 3.1 — commands, ingestion, admin (Phase 0 identity surface + Appendix C animal/device baseline) | §45–§47, Appendix C |
| `graphql/schema.graphql`      | GraphQL read schema (read-first, shared authorization)                                                       | §48, Appendix D     |
| `asyncapi/domain-events.yaml` | AsyncAPI 3.0 domain event topics (identity events + weight-recorded baseline)                                | §49, Appendix E     |
| `json-schema/`                | Domain event envelope + per-event payload schemas (JSON Schema 2020-12)                                      | §39, Appendix E     |
| `examples/`                   | Valid example documents and error cases                                                                      | §52                 |

The domain event envelope JSON Schema mirrors the executable zod schema in
`packages/domain-kernel/src/event-envelope.ts`; the zod schema is the
runtime validator, and this directory publishes its portable form. If they
ever diverge, fix the divergence in the same change — CI treats drift as a
build failure.

## Governance (§52)

Every external contract in this directory has:

1. **Machine-readable source in the repository** — this directory; no
   contract exists only in a wiki, ticket, or generated artifact.
2. **Human-readable description** — inline `description` fields plus this
   README.
3. **Examples and error cases** — `examples/` (valid envelopes, an RFC 9457
   Problem Details error, a device observation batch).
4. **Generated validation in CI** — `pnpm contracts:validate`
   (`scripts/validate/contracts-validate.mjs`) parses and validates every
   document on every pull request; drift between generated artifacts and
   committed contracts fails the build.
5. **Compatibility check against the last production release** — breaking
   changes (removed field, narrowed type, removed enum value, removed
   endpoint/channel, changed subject) are rejected by the compatibility gate;
   until the first production release the gate compares against `main`.
6. **Version and deprecation policy** — see below.
7. **Responsible owner** — the platform contracts owner; changes require
   review by the owning module team.
8. **Security and data-classification review** — contract changes touching
   personal data (emails, display names), health, or finance fields require
   an explicit data-classification note in the PR.

## Versioning and deprecation

- **REST**: base path `/api/v1`. Additive changes (new optional fields,
  new endpoints, new enum values on _responses_) are non-breaking. Breaking
  changes require `/api/v2` and a published deprecation window for v1.
- **Events**: the version is part of the event type and the subject
  (`identity.tenant_created.v1`,
  `jk.{environment}.{tenantShard}.identity.tenant.tenant-created.v1`).
  Payload changes that are not strictly additive require a new `.v2` event
  published alongside `.v1` during the migration window. Envelopes are
  append-only facts and are never rewritten.
- **GraphQL**: schema changes pass breaking-change detection; fields are
  deprecated with `@deprecated(reason:)` before removal.
- **Deprecation**: announced in release notes with a minimum overlap window;
  deprecated surfaces emit telemetry so remaining consumers are visible
  before removal.

## Conventions recap (§46, §49)

- JSON is camelCase; identifiers (UUID/ULID) are opaque strings.
- `Idempotency-Key` header is required on all POST commands.
- Errors are RFC 9457 Problem Details with `code` and `correlationId`.
- Lists use cursor pagination (`limit` + `cursor`, stable ordering).
- Event subjects never expose raw tenant identifiers; the envelope carries
  `tenantId`, the subject carries a non-sensitive shard.
- Canonical identity event types (fixed):
  `identity.tenant_created.v1` (tenant), `identity.farm_created.v1` (farm),
  `identity.user_invited.v1`, `identity.membership_activated.v1`,
  `identity.membership_revoked.v1` (user).
- Canonical tenant-membership roles: `tenant_owner`, `farm_manager`,
  `technician`, `veterinarian`, `genetics_specialist`, `finance_user`,
  `auditor`, `integration_service` (`platform_admin` is platform-level,
  outside tenant membership).

## Validation

```bash
pnpm contracts:validate   # OpenAPI + GraphQL + AsyncAPI + JSON Schema
```

Sample data in examples is synthetic (Fazenda Boa Vista, Brangus herd,
pt-BR locale) and never contains real personal data, credentials, or
production identifiers.
