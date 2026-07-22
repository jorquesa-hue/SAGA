# ADR-006: First physical scale/RFID vendors and protocols

- **Status:** OPEN
- **Date:** 2026-07-22 (opened; not yet decided)
- **Deciders:** founder + engineering lead (pending)
- **Requirement IDs:** §19 (JK-WGT-001..), §33 (adapter types), §56 (edge
  gateway), JK-DOM-009 (raw payload preservation), JK-CON-010 (automation
  traceability)
- **Related:** [ADR-004](ADR-004-nats-jetstream-hosting.md) (event
  transport), spec §94 risk "Hardware protocol variability"

## Context

Which physical scale and RFID reader vendors (e.g. Tru-Test, Gallagher,
Allflex readers, serial/Bluetooth stick readers common on Brazilian
fazendas) the first production farm uses is undecided, and so are their
wire protocols. §33 mandates that vendor-specific protocols never leak into
animal/weight/finance domain models; §94 mitigates protocol variability with
an adapter SDK, simulator, raw payload retention, and vendor acceptance
tests.

## Decision

OPEN. **Default until decided (spec §93, verbatim):** *"Simulator plus
adapter interface; no vendor code in domain layer."*

The repository honors the default today:

- No vendor code exists anywhere in the tree (nothing to quarantine yet).
- The device-observation ingestion contract is vendor-neutral:
  `contracts/openapi/jk-platform.yaml` (observation batch ingestion,
  Appendix C baseline) and `contracts/examples/observation-batch.example.json`
  preserve `rawPayload` per JK-DOM-009.
- The planned home for adapters is `devices/adapter-sdk`, `devices/simulators`,
  `devices/adapters` (spec Appendix F); these directories arrive with Phase 1.

**Decision criteria:**

1. What hardware the first farm actually owns/buys (founder input).
2. Protocol openness: documented serial/Bluetooth/TCP protocols vs
   reverse-engineering risk.
3. ISO 11784/11785 FDX/HDX tag compatibility for RFID.
4. Availability of vendor simulators or replay captures for acceptance tests
   (§94 mitigation).
5. Local (Brazil) support and calibration services (§25 asset calibration).

## Consequences

Blocked until this closes:

- First real adapter implementation in `devices/adapters/` (Phase 1).
- Vendor acceptance test suites.
- Purchase/integration timeline for the Phase 1 exit criterion (500-animal
  simulated handling session still works with the simulator alone).

Not blocked: the simulator, adapter SDK interface, and edge gateway (Phase 1)
proceed vendor-neutral by design.

## Verification

Architecture boundary check (`scripts/validate/architecture-check.mjs`)
already enforces that feature packages depend only on the kernel and shared
technical packages — vendor SDKs will be confined to `devices/adapters/*`
when they arrive.
