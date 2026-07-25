# ADR-002: Managed identity provider

- **Status:** OPEN
- **Date:** 2026-07-22 (opened; not yet decided)
- **Deciders:** founder + engineering lead (pending)
- **Requirement IDs:** JK-IAM-002 (OIDC/OAuth 2.1), JK-SEC-003 (MFA),
  JK-SEC-008 (no local passwords without ADR), §17, §30.1 (identity layer)
- **Related:** [ADR-001](ADR-001-cloud-provider-and-region.md),
  [ADR-005](ADR-005-mobile-distribution-and-mdm.md) (mobile auth flows)

## Context

Spec §93 leaves the managed identity provider undecided. JK-IAM-002 mandates
OIDC/OAuth 2.1-compatible providers; JK-SEC-003 mandates MFA for privileged
roles; JK-SEC-008 forbids SAGA storing passwords when external OIDC is
used. Candidates include Keycloak (self-managed), and managed offerings
(Auth0/Okta, AWS Cognito, Azure Entra External ID, Google Identity Platform,
Zitadel, etc.). Rural offline/admin needs and per-MAU pricing differ sharply.

## Decision

OPEN. **Default until decided (spec §93, verbatim):** _"Standards-based OIDC;
compare security, cost, offline/admin needs."_

The repository honors the default today:

- `database/migrations/0002_identity_and_membership.sql` stores only
  `user_account.oidc_subject` — no password column exists anywhere.
- `.env.example` carries `OIDC_ISSUER_URL` / `OIDC_AUDIENCE` as the only
  identity coupling (standards-based discovery).
- `infrastructure/compose/docker-compose.yml` runs Keycloak in dev mode as a
  **local stand-in only**; its realm bootstrap is intentionally manual until
  this ADR closes (noted inline in the compose file).
- `apps/api` verifies OIDC-issued JWTs generically (`jose`), not against a
  vendor SDK.

**Decision criteria:**

1. OIDC/OAuth 2.1 + PKCE conformance and token customization (tenant/role
   claims).
2. MFA support incl. TOTP for tenant owners and platform admins (JK-SEC-003).
3. Cost model at expected MAU (farm staff counts are small; per-MAU pricing
   may still beat operating Keycloak given §94 small-team risk).
4. Offline/token-lifetime behavior for rural mobile use (JK-CON-008).
5. Admin/break-glass procedures and audit export (§68).
6. Data residency for personal data (§69 LGPD).

## Consequences

Blocked until this closes:

- Production realm/tenant provisioning automation.
- Final login flows in web (Phase 1+) and mobile (Phase 1+ apps).
- MFA enforcement configuration (JK-SEC-003) — modeled but not enforceable
  against a stand-in.
- Any local break-glass credential design (explicitly requires its own ADR
  per JK-SEC-008).

## Verification

No password columns in `database/migrations/`; API token verification is
issuer-configurable; Keycloak appears only in
`infrastructure/compose/docker-compose.yml` (local) and never in Terraform.
