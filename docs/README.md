# SAGA — Documentation

Engineering documentation for the SAGA implementation of
**JK-PLT-EES-001**. Start here.

## Map

- **[PHASE0-HANDOVER.md](PHASE0-HANDOVER.md)** — status and remaining work.
- **Architecture**
  - [c4-context-and-container.md](architecture/c4-context-and-container.md) — C4 + implemented-vs-specified.
- **Domain**
  - [bounded-contexts.md](domain/bounded-contexts.md) — §7 contexts and target packages.
- **Data**
  - [data-dictionary/phase0.md](data-dictionary/phase0.md) — every table/column/constraint/RLS.
- **Decisions (ADRs)**
  - [adr/README.md](adr/README.md) — index. ADR-001..010 are the spec's open
    decisions; ADR-011..013 are accepted Phase 0 decisions (pg driver, RLS
    tenancy, Fastify-first API).
- **Security**
  - [security/threat-model.md](security/threat-model.md) — STRIDE + §65.1 + §67 checklist.
- **Operations**
  - [operations/local-development.md](operations/local-development.md)
  - [operations/runbook-outbox.md](operations/runbook-outbox.md)
  - [operations/runbook-backup-restore.md](operations/runbook-backup-restore.md)
- **Traceability**
  - [traceability/matrix.md](traceability/matrix.md) + [matrix.csv](traceability/matrix.csv)
    — requirement → source → test → status.

## Conventions

- The specification is a contract, not inspiration (`../CLAUDE.md`).
- Work in vertical slices; keep every quality gate green; update the
  traceability matrix with each change.
- Truthful status only: **implemented** means code + passing tests exist here;
  **planned** means scheduled in a later phase (Volume XII).
