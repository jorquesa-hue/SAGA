# ADR-000: Template

- **Status:** TEMPLATE (use one of: PROPOSED / OPEN / ACCEPTED / SUPERSEDED by ADR-NNN / REJECTED)
- **Date:** YYYY-MM-DD
- **Deciders:** names/roles
- **Requirement IDs:** the JK-PLT-EES-001 requirement IDs this decision affects
  (e.g. `JK-SEC-004`, `JK-IAM-002`) and the spec sections (e.g. §30.1, §67)
- **Related:** links to related ADRs, spec sections, issues

## Context

What situation forces a decision? State the constraints (spec mandates,
budget, team size, vendor landscape, legal/data-residency), the options that
were seriously considered, and any spec-mandated "default until decided"
behavior that applies while the decision is open.

## Decision

The decision, stated in the active voice ("We will use X for Y"). For an OPEN
ADR, state the **default-until-decided** posture verbatim from spec §93 and
the concrete **decision criteria** that will close it.

## Consequences

- What becomes easier.
- What becomes harder or is given up.
- What work is **blocked** until this decision closes (name repo paths).
- Follow-up actions (migrations, re-evaluations, expiry dates).

## Verification

How the repository proves the decision is honored (tests, CI gates, file
paths). Every ACCEPTED ADR must point at executable evidence; every OPEN ADR
must point at the guard rails that keep the default posture true (e.g.
provider-neutral interfaces, adapter seams).
