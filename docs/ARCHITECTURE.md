# SAGA — Architecture

## Goals

- **Correctness of business rules** over framework cleverness. An ERP lives or
  dies by whether its rules (areas, stock, costs, traceability) are right.
- **Incremental delivery.** Add modules as vertical slices without destabilising
  what exists.
- **Swappable infrastructure.** Start with in-memory persistence for fast,
  dependency-free tests; move to PostgreSQL without touching business logic.

## Hexagonal (ports & adapters)

```
        ┌─────────────────────────────────────────────┐
        │                 HTTP / REST                  │  ← infrastructure (Express)
        └───────────────────────┬─────────────────────┘
                                │ calls
        ┌───────────────────────▼─────────────────────┐
        │              Application / Use cases          │  ← orchestrates domain
        │   (CreateFarm, RegisterParcel, OpenCropCycle) │
        └───────┬───────────────────────────┬──────────┘
                │ depends on (ports)         │
   ┌────────────▼───────────┐     ┌──────────▼───────────┐
   │        Domain          │     │  Repository ports     │
   │  Entities & rules      │     │  (interfaces)         │
   │  (pure TypeScript)     │     └──────────┬───────────┘
   └────────────────────────┘                │ implemented by
                                  ┌───────────▼───────────┐
                                  │  Adapters              │
                                  │  In-memory (now)       │
                                  │  PostgreSQL (later)    │
                                  └────────────────────────┘
```

- **Domain** (`src/domain`): entities, value objects, invariants. No imports from
  frameworks or the database. Example rule: a parcel's cultivated area cannot
  exceed the parcel's total area; a crop cycle cannot close before it opens.
- **Application** (`src/application`): use cases that coordinate domain objects
  and depend only on **ports** (repository interfaces), never concrete adapters.
- **Infrastructure** (`src/infrastructure`): concrete adapters — the in-memory
  repositories and the Express HTTP layer. This is where frameworks live.

## Multi-tenancy

Every aggregate carries an `organizationId`. This makes it straightforward to
support multiple agribusinesses (or multiple farms of one holding) in a single
deployment, and to enforce data isolation at the repository/query boundary.

## Validation

Input at the HTTP boundary is validated with [Zod](https://zod.dev). Domain
invariants are additionally enforced inside entities, so business rules hold even
if a new entry point (a job, an import, another API) bypasses the HTTP layer.

## Testing

- **Domain unit tests**: pure, fast, no I/O.
- **Use-case tests**: run against in-memory adapters.
- Run with `npm test` (Vitest).

## Planned move to PostgreSQL

The repository ports are designed so a `PostgresFarmRepository` etc. can be
added under `infrastructure/persistence/postgres` with a schema migration, and
wired in `index.ts`, with **no change** to domain or application code.
