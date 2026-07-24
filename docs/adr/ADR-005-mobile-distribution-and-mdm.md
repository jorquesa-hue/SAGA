# ADR-005: Mobile distribution and MDM

- **Status:** OPEN
- **Date:** 2026-07-22 (opened; not yet decided)
- **Deciders:** founder + engineering lead (pending)
- **Requirement IDs:** §30.1 (mobile baseline), §55 (mobile application),
  JK-CON-008 (offline continuity), §34 (offline/sync architecture)
- **Related:** [ADR-002](ADR-002-managed-identity-provider.md) (mobile auth)

## Context

The mobile stack is fixed by §30.1 (React Native with Expo development
build). §93 leaves open how the app is **distributed** to farm devices —
public App Store/Play Store, private/enterprise distribution, EAS internal
distribution — and whether farm-owned devices get MDM (mobile device
management) for enforcement of device encryption and remote wipe (relevant
because §34 mandates an encrypted local database on device).

`apps/mobile` does not exist yet (Phase 1+, spec Volume XII); no distribution
work is possible or needed in Phase 0 beyond keeping the decision visible.

## Decision

OPEN. **Default until decided (spec §93, verbatim):** _"Expo development
build with secure release pipeline."_

**Decision criteria:**

1. Farm device ownership model: company-owned handhelds (MDM viable) vs
   personal devices (store distribution).
2. Update cadence needs vs store review latency (OTA updates via Expo
   Updates for JS-only changes).
3. Device security baseline: enforced device encryption, screen lock, remote
   wipe for lost devices carrying the offline SQLite store (§34, §65).
4. Cost and operational weight of MDM for a small fleet.
5. Play Store/App Store policy fit for an enterprise B2B app in Brazil.

## Consequences

Blocked until this closes:

- Release-pipeline workflow for `apps/mobile` (app does not exist yet;
  Phase 1 per `docs/architecture/phase0-implementation.md`).
- Device-security requirements in the threat model's mobile section
  ([docs/security/threat-model.md](../security/threat-model.md) scopes
  Phase 0 to server surfaces and marks mobile as future work).

## Consequences of the default

Expo development builds keep the team unblocked for Phase 1 development on
test devices while no store/MDM commitment exists.

## Verification

Nothing to verify in-repo yet; this ADR is the visible blocker required by
CLAUDE.md before any mobile distribution work begins.
