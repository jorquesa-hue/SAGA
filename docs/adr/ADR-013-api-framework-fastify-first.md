# ADR-013: API framework — Fastify-first for Phase 0, NestJS deferred

- **Status:** ACCEPTED
- **Date:** 2026-07-22
- **Deciders:** Phase 0 engineering
- **Requirement IDs:** §30.1 (technology baseline: "NestJS, Fastify adapter"),
  §45-§47 (API strategy and REST conventions), §31 (modular monolith)
- **Related:** [ADR-011](ADR-011-postgres-driver-and-sql-migrations.md)

## Context

§30.1 names the API baseline as "Node.js LTS, NestJS, Fastify adapter". The
Phase 0 API surface is small and stable: health probes plus six identity
endpoints (tenants, farms, user invitations, users). All business logic lives
in the bounded-context application services (`@jk/identity-tenancy`); the HTTP
layer only authenticates, builds a `TenantContext`, validates headers, calls a
service, and maps errors to RFC 9457 Problem Details.

NestJS adds decorator-based dependency injection and metadata reflection.
Under the repository's strict ESM (`NodeNext`) + Vitest toolchain this requires
`reflect-metadata`, an SWC transform for tests, and careful provider wiring —
non-trivial machinery whose value is DI ergonomics across a large module graph
that Phase 0 does not yet have.

## Decision

Phase 0 builds `apps/api` **directly on Fastify** — the exact runtime NestJS's
adapter would use — organised into small modules (`config`, `auth`,
`request-context`, `problem`, `routes/*`). The HTTP concerns the spec requires
(§46-§47) are all implemented: Idempotency-Key enforcement, Problem Details,
cursor-ready list envelopes, correlation IDs, OIDC bearer verification, and
server-side tenant resolution.

NestJS adoption is **deferred**, not rejected. It is revisited when the module
graph grows (Phase 1+ adds animal-registry, weighing, health, reproduction
controllers) and the DI ergonomics pay for their tooling cost. Because all
logic sits behind application-service ports, wrapping the same services in
NestJS controllers later is mechanical and does not touch domain code.

## Consequences

- **Positive:** minimal, fast, dependency-light API; trivial `inject()`-based
  integration tests; no decorator/metadata/ESM friction; same Fastify runtime
  and HTTP semantics the spec targets.
- **Negative:** a documented deviation from the §30.1 wording; controllers are
  plain route registrations rather than Nest modules, so the eventual NestJS
  migration is additive work.
- **Revisit when:** the controller count or cross-cutting concern count makes
  manual wiring costlier than Nest's DI — reassessed at the start of Phase 1.
