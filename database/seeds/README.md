# Database seeds

Synthetic reference-farm seed data (JK-PLT-EES-001 §6). **Synthetic only** —
no production data, credentials, or personal data ever enters through seeds
(constitution invariant 7). Real data arrives exclusively through the staged
import workflow (§27) and data-migration strategy (§87).

## Contents (`0001_reference_farm.sql`) — the minimal reference farm

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

## Contents (`0002_jq_farm_demo.sql`) — the JQ Farm demonstration tenant

**Generated, not committed.** `scripts/bootstrap/generate-demo-seed.mjs` writes
this file and `pnpm db:seed` runs the generator first, so the SQL can never
drift from the generator that produced it. The generator is the reviewable
artefact; its multi-megabyte output is in `.gitignore`.

A second synthetic tenant that carries data in **every** module, so the console
has something to show on every screen. Setting: a beef and Brangus
genetic-nucleus operation in the Serra da Bocaina foothills near Cunha, SP,
across two blocks (Sede Lagoinha, 312 ha; Retiro Paraitinga, 148 ha).

| Module                | Rows                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------ |
| tenancy & identity    | 1 tenant, 2 farms, 7 users, 7 tenant + 12 farm memberships                           |
| animal registry       | 200 animals, 498 identifiers (rfid/visual/official/retired), 160 parentage links     |
| herd operations       | 7 lots, 195 memberships, 9 handling sessions, 882 device observations, 866 weighings |
| land & grazing        | 26 paddocks (PostGIS), 69 occupations, 156 pasture assessments                       |
| health & laboratory   | 6 protocols, 707 treatments, 394 restrictions, 6 clinical cases                      |
| reproduction          | 146 services, 150 pregnancy checks, 44 calvings across two stations                  |
| genetics              | 644 breeding values (7 traits), 2 selection indexes                                  |
| nutrition & inventory | 15 items, 43 batches, 254 stock movements                                            |
| assets & maintenance  | 12 assets, 12 maintenance schedules, 7 work orders                                   |
| finance & commerce    | 134 ledger entries (incl. one reversal), 132 allocations, 16 sales, 224 budget lines |
| analytics             | 44 tasks, 17 alerts                                                                  |
| governed AI           | 7 recommendations with evidence, 1 blocked autonomous execution, full audit trail    |
| integrations          | 5 connectors, 3 webhook subscriptions, 24 deliveries (incl. one dead-lettered)       |
| exports & imports     | 5 export jobs across every status, 2 staged imports with 11 rows                     |
| event ledger          | 2 263 domain events, 198 published outbox messages                                   |

### What the data deliberately shows

The dataset is not uniformly clean, because a demo of clean data proves
nothing. It contains an open weighing session, unresolved scale reads waiting
on a human, weighings flagged and excluded from analytics rather than deleted,
active withdrawal restrictions blocking sale clearance, a lapsed scale
calibration, stock below the reorder level, a financial entry reversed by a
compensating entry, a webhook delivery that exhausted its retries, an expired
export that was then denied on download, and an import stuck at validation with
rows an operator still has to fix.

### Determinism

The generator has no clock and no entropy source: every timestamp is an offset
from a fixed anchor and every choice comes from a seeded PRNG, so running it
twice produces a byte-identical file. Ids are fixed literals in obviously-fake
ranges (`10……` tenant, `16……` animal, and so on — see the `NS` map in the
generator). Idempotent: re-running the SQL yields identical counts.

## Seeing it without a database

The console can run on any static host — including the git-linked Vercel project
built straight from this repo — with no server behind it:

1. `pnpm demo:snapshot` captures every GET the console makes against the seeded
   JQ Farm tenant into one file, `scripts/demo/snapshot.json` (~0.9 MB). This
   needs the API running against a seeded database, and is the only step that
   does. The file is committed, so hosts never need a database.
2. `pnpm demo:static` builds the console and injects a small read-only shim
   (`scripts/demo/demo-api.js`) that answers `/api/v1/*` from that snapshot.

The root `vercel.json` runs both halves of step 2 as its build command, so a
push is all it takes for the Vercel project to serve the demo. The shim patches
`window.fetch` before the app loads:

- **GET** → the captured response, or a `404` problem for a path outside the
  snapshot;
- **any write** → a `501` read-only notice. Nothing fakes a successful command,
  so a form can never look like it saved when it did not.

Reads are real seeded data; writes need the API and the database. Sign in with
the seeded owner and tenant ids:

```
user  12000000-0000-4000-8000-000000000001   (Joaquim Queiroz Andrade)
org   10000000-0000-4000-8000-000000000001   (JQ Farm)
```

Those are not credentials in any meaningful sense — they are the local
development auth seam (`apps/api/src/auth.ts`), which refuses to start outside
`APP_ENV=local`. A deployed environment authenticates through OIDC.

## Determinism (`0001_reference_farm.sql`)

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
