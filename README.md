# SAGA — ERP para el Agronegocio

**SAGA** is an ERP (Enterprise Resource Planning) system for the agribusiness
sector: farms, parcels, crop cycles, agricultural inputs, harvests, inventory,
business partners, procurement, sales and traceability.

> **Status: foundation / early scaffold.**
> This repository currently contains the *core domain foundation* and a working,
> fully-tested backend slice (master data: farms, parcels, crop cycles, partners).
> It is built to grow **module by module** as the full SAGA specification is
> digested. See [`docs/ROADMAP.md`](docs/ROADMAP.md) for the plan.

## Why it's built this way

An agribusiness ERP is a large system. Rather than a fragile "everything at once"
demo, SAGA is built in **vertical slices** on a **hexagonal (ports & adapters)**
architecture:

- The **domain** is pure TypeScript with no framework or database dependencies —
  it encodes the business rules and is fully unit-tested.
- **Adapters** (in-memory now, PostgreSQL later) plug into the domain via ports,
  so we can swap persistence without rewriting business logic.
- Each **module** (master data, inventory, procurement, sales, agronomy,
  traceability, finance…) is added as a self-contained slice.

This means: after every session you have something that **runs and is tested**,
and the codebase stays coherent as it scales toward the full spec.

## Repository layout

```
SAGA/
├── docs/                  Architecture, domain model, module roadmap
│   ├── ARCHITECTURE.md
│   ├── DOMAIN_MODEL.md
│   └── ROADMAP.md
└── backend/               TypeScript backend (API + domain)
    ├── src/
    │   ├── domain/        Pure business entities & rules (no deps)
    │   ├── application/   Use cases + ports (repository interfaces)
    │   ├── infrastructure/  Adapters: in-memory repos, HTTP (Express)
    │   └── index.ts       Server bootstrap
    └── tests/             Unit tests (Vitest)
```

## Quick start

```bash
cd backend
npm install
npm test          # run the unit tests
npm run dev       # start the API on http://localhost:3000
```

Try it:

```bash
curl http://localhost:3000/health
curl -X POST http://localhost:3000/api/farms \
  -H 'Content-Type: application/json' \
  -d '{"name":"Finca La Esperanza","totalAreaHa":120.5,"municipality":"Écija","province":"Sevilla"}'
curl http://localhost:3000/api/farms
```

## Where this is going

This foundation is intentionally a **starting point**, not the finished ERP.
The next steps — once the SAGA specification document is available — are to map
the spec's entities, workflows and rules onto this architecture and implement the
remaining modules. See [`docs/ROADMAP.md`](docs/ROADMAP.md).
