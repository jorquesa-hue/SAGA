# @jk/edge-gateway

On-farm edge gateway (§34). Sits on the barn/paddock LAN, ingests RFID/scale
device readings, buffers them **durably on local disk**, and batches them
upstream to the platform API — designed for intermittent rural connectivity so
a capture is never lost when the uplink is down.

## How it works

- **Ingest** (`POST /ingest`, `POST /ingest:batch`): device readers push
  readings; each is persisted to disk _before_ the request returns, then the
  handler responds `202`. The uplink is never on the ingest critical path.
- **Buffer**: a `FileLocalStore` (durable `LocalStore` from `@jk/offline-sync`)
  writes the whole snapshot through a temp-file rename on every mutation, so a
  crash or power loss mid-write never corrupts the backlog. It reloads on start
  — buffered readings survive restarts.
- **Flush**: a timer runs `EdgeGateway.flush()`, which drives the offline-sync
  engine to deliver buffered readings to the idempotent
  `POST /api/v1/device-observations:batch` (via the shared `@jk/sync-http`
  transport). Guarantees: never lose a reading, at-least-once, idempotent,
  crash-safe, backoff — the same engine the mobile app uses.
- **Status** (`GET /status`): `{ buffered, delivered, parked }`.

Rejected readings (e.g. an unknown RFID) are **parked** (`rejected`) for human
review, never dropped.

## Configuration (Appendix G)

| var                                      | purpose                                                 |
| ---------------------------------------- | ------------------------------------------------------- |
| `EDGE_TENANT_ID`                         | tenant the gateway belongs to (required)                |
| `EDGE_DEV_USER_ID` _or_ `EDGE_API_TOKEN` | local dev auth, or a bearer token                       |
| `API_BASE_URL`                           | platform API origin (default `http://localhost:4000`)   |
| `EDGE_GATEWAY_ID`                        | gateway identifier stamped on observations              |
| `EDGE_DATA_FILE`                         | durable buffer path (default `./data/edge-outbox.json`) |
| `FLUSH_INTERVAL_MS`                      | upstream flush cadence (default 5000)                   |
| `PORT`                                   | HTTP port (default 4200)                                |

```bash
pnpm --filter @jk/edge-gateway build
EDGE_TENANT_ID=<uuid> EDGE_DEV_USER_ID=<uuid> node dist/main.js
```

## Tests

```bash
pnpm --filter @jk/edge-gateway test:unit
```

Covers buffer durability across a restart, ingest → flush delivery, **loses
nothing while the uplink is down then drains on recovery**, and parking a
rejected reading for review. A production deployment swaps the file buffer for
a SQLite adapter (same `LocalStore` contract) at high device volume.
