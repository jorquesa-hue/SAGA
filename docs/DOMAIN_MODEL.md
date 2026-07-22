# SAGA — Domain Model (core)

This is the **core** master-data model that most agribusiness ERP workflows build
on. It will be extended as the full specification is digested. Spanish domain
terms are noted because agribusiness in Spain uses specific concepts (e.g. SIGPAC
cadastral references).

## Aggregates implemented in the current slice

### Organization (Organización / Empresa)
The tenant. Every other record belongs to exactly one organization.

| Field       | Type     | Notes                          |
|-------------|----------|--------------------------------|
| id          | UUID     |                                |
| name        | string   | Legal / trading name           |
| taxId       | string?  | CIF/NIF                        |

### Farm (Explotación / Finca)
A production unit — a farm or estate.

| Field        | Type    | Notes                                   |
|--------------|---------|-----------------------------------------|
| id           | UUID    |                                         |
| organizationId | UUID  |                                         |
| name         | string  |                                         |
| totalAreaHa  | number  | Hectares; ≥ 0                           |
| municipality | string? | Municipio                               |
| province     | string? | Provincia                               |

**Rule:** the sum of registered parcels' areas should not exceed `totalAreaHa`
(warned/validated at the application layer).

### Parcel (Parcela / Lote)
A delimited piece of land within a farm.

| Field           | Type    | Notes                                        |
|-----------------|---------|----------------------------------------------|
| id              | UUID    |                                              |
| organizationId  | UUID    |                                              |
| farmId          | UUID    |                                              |
| code            | string  | Internal parcel code                         |
| areaHa          | number  | Hectares; > 0                                |
| sigpacRef       | string? | SIGPAC reference (Prov:Mun:Agg:Zone:Pol:Parc)|
| irrigation      | enum    | `rainfed` \| `irrigated`                     |

**Rule:** `areaHa` must be > 0.

### CropCycle (Campaña de cultivo)
A crop grown on a parcel during a season.

| Field          | Type    | Notes                                     |
|----------------|---------|-------------------------------------------|
| id             | UUID    |                                           |
| organizationId | UUID    |                                           |
| parcelId       | UUID    |                                           |
| crop           | string  | e.g. "Trigo blando", "Olivar", "Tomate"   |
| variety        | string? |                                           |
| cultivatedAreaHa | number| ≤ parcel area                             |
| plannedSowing  | Date?   | Fecha de siembra prevista                 |
| plannedHarvest | Date?   | Fecha de recolección prevista             |
| status         | enum    | `planned` \| `active` \| `harvested` \| `closed` |

**Rules:**
- `cultivatedAreaHa` must be > 0 and ≤ the parent parcel's `areaHa`.
- Status transitions: `planned → active → harvested → closed` (no skipping back).

### Partner (Tercero: Cliente / Proveedor)
A business partner — customer, supplier, or both.

| Field          | Type    | Notes                                     |
|----------------|---------|-------------------------------------------|
| id             | UUID    |                                           |
| organizationId | UUID    |                                           |
| name           | string  |                                           |
| taxId          | string? | CIF/NIF                                   |
| kind           | enum    | `customer` \| `supplier` \| `both`        |
| email          | string? |                                           |

## Planned aggregates (future slices)

- **Product / Item** — inputs (seeds, fertilisers, phytosanitary products) and
  outputs (harvested produce), with units of measure.
- **Warehouse & StockMovement** — inventory with lot/batch tracking.
- **PurchaseOrder / SalesOrder** — procurement and sales.
- **FieldOperation / Task** — agronomic operations (tillage, sowing, treatment,
  fertigation, harvest) with input consumption → basis for cost per hectare and
  traceability.
- **TreatmentRecord** — phytosanitary applications with safety intervals
  (regulatory traceability).
- **CostCenter / JournalEntry** — analytical accounting per parcel/crop cycle.

See [`ROADMAP.md`](ROADMAP.md) for sequencing.
