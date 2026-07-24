# Database seeds

Synthetic reference-farm seed data (JK-PLT-EES-001 §6). **Synthetic only** —
no production data, credentials, or personal data ever enters through seeds
(constitution invariant 7). Real data arrives exclusively through the staged
import workflow (§27) and data-migration strategy (§87).

## Contents (`0001_reference_farm.sql`)

A reference Brangus operation on ~100 ha near Lagoinha/Cunha, SP:

| Entity            | Count | Notes                                                    |
| ----------------- | ----- | -------------------------------------------------------- |
| tenant            | 1     | Fazenda JK (Referência Sintética), pt-BR / BRL           |
| farm              | 1     | Sede Lagoinha, 100 ha, America/Sao_Paulo                 |
| paddock           | 12    | Pasto 01–12, PostGIS MultiPolygon geometries (SRID 4326) |
| user_account      | 6     | one per operational role (§17)                           |
| tenant_membership | 6     | active, one per user                                     |
| farm_membership   | 5     | farm-scoped roles (owner is tenant-level)                |
| animal            | 15    | 10 female / 5 male Brangus, varied birth-date precision  |
| animal_identifier | 30    | active RFID + visual tag per animal (JK-DOM-003)         |
| domain_event      | 1     | worked `animal.animal_registered.v1` example (BR-0001)   |
| outbox_message    | 1     | matching transactional-outbox row (§39 envelope shape)   |

## Determinism

All primary keys are fixed literal UUIDs in the obviously-fake range
`00000000-0000-4000-8000-............`, and all timestamps are fixed literals,
so any seeded environment is directly comparable. Emails use the RFC 2606
reserved `example.com` domain.

## Running

```bash
pnpm db:migrate    # schema must exist first
pnpm db:seed       # applies every database/seeds/*.sql on DATABASE_URL
```

Idempotent: every statement uses `ON CONFLICT DO NOTHING`, so re-running
produces identical counts and never mutates append-only history.

The seed runs on the owner/system connection. Under an application role
(`jk_app`) it is invisible without a tenant context and scoped to the tenant
with one — verify:

```bash
# 0 rows (fail-closed):
psql "$APP_URL" -tc "SELECT count(*) FROM animal;"
# 15 rows (scoped):
psql "$APP_URL" -tc "SET app.tenant_id='00000000-0000-4000-8000-000000000001'; SELECT count(*) FROM animal;"
```
