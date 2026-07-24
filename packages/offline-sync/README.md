# @jk/offline-sync

Platform-agnostic offline-first sync engine for the mobile and edge clients
(§34). Zero runtime dependencies, so it runs unchanged in React Native, on the
edge gateway, and in Node tests.

## Guarantees (invariants #4 / #5)

- **Never lose an observation.** A captured record leaves the `pending` state
  only when the server _accepts_ it (→ `synced`) or _permanently rejects_ it
  (→ `rejected`, parked for human review — never deleted).
- **At-least-once, idempotent.** Every record carries a stable client id that
  is also the server idempotency key; re-delivery is safe and de-duplicated.
- **Crash-safe.** Records stranded `in_flight` by an interrupted round are
  reclaimed to `pending` and re-sent on the next sync.
- **Partial success.** Each record's outcome is applied independently; a
  missing per-record outcome is treated as retryable, never as success.
- **Backoff.** Retryable records are not re-sent before their next-attempt time.

## Pieces

- `LocalStore` — durable storage contract. `InMemoryLocalStore` is the
  reference implementation and the contract device adapters (encrypted
  SQLite / AsyncStorage) must honor.
- `Outbox.capture()` — persists an observation/command locally and returns
  immediately; the network is never on the critical path of a field capture.
- `SyncEngine.sync()` / `syncAll()` — flush due records to an injected
  `SyncTransport` with the guarantees above.
- Read-model `getCheckpoint` / `setCheckpoint` — opaque cursors per stream for
  pulling server updates.

## Wiring on device

Implement `SyncTransport.deliver(records)` against the platform API — e.g. map
`observation` records to `POST /api/v1/device-observations:batch` (which
returns a 207 with a per-observation result) and translate each result to
`accepted | retryable | rejected`. Back `LocalStore` with an encrypted SQLite
adapter. The engine itself needs no changes.

```ts
const store = new SqliteLocalStore(db); // device adapter
const outbox = new Outbox({ store });
await outbox.capture({ kind: "observation", operation: "weight", payload: { rfid, kg } });
// …later, when connectivity returns:
const engine = new SyncEngine({ store, transport: new HttpSyncTransport(client) });
await engine.syncAll();
```
