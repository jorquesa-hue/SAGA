# SAGA — Build Roadmap

SAGA is delivered in **vertical slices**. Each slice is a working, tested
increment. This roadmap is the default sequencing for an agribusiness ERP; it
will be **reconciled against the full SAGA specification** once that document is
available, and re-prioritised with you.

## Phase 0 — Foundation ✅ (this repository)
- Hexagonal architecture, project scaffold, CI-ready tests.
- Core master data: **Organization, Farm, Parcel, CropCycle, Partner**.
- In-memory persistence + REST API + unit tests.

## Phase 1 — Persistence & platform
- PostgreSQL adapters + schema migrations.
- Authentication & authorisation (roles: admin, agronomist, warehouse, finance).
- Audit trail; per-organization data isolation enforced in queries.

## Phase 2 — Products & Inventory
- Product/Item catalogue (inputs & outputs), units of measure.
- Warehouses, stock movements, lot/batch tracking, stock valuation.

## Phase 3 — Agronomy & Operations
- Field operations/tasks (tillage, sowing, fertigation, treatment, harvest).
- Input consumption per operation → **cost per hectare** and **per crop cycle**.
- Phytosanitary treatment register with pre-harvest safety intervals.

## Phase 4 — Procurement & Sales
- Purchase orders, goods receipts, supplier invoices.
- Sales orders, deliveries, customer invoices.
- Link harvests → stock → sales.

## Phase 5 — Traceability & Compliance
- Batch traceability from parcel → harvest → lot → sale.
- Regulatory records (treatments, fertilisation plans, harvest logs).

## Phase 6 — Finance & Analytics
- Analytical accounting (cost centres per parcel/crop cycle).
- Dashboards & reports: yield, cost, margin per hectare / crop / campaign.

## Phase 7 — Frontend
- Web UI (module by module) once the API surface stabilises.

---

### How the spec plugs in
When the ~1000-page SAGA document is provided, the first task is a **digest pass**
that extracts: entities, attributes, relationships, workflows, business rules,
user roles, documents/reports, and integrations. That digest maps directly onto
the phases above — adding, renaming or reprioritising slices as needed — and each
mapped module is then implemented on the existing architecture.
