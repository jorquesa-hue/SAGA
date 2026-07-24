# @jk/mobile — JK Platform field app

React Native, offline-first. Cattle handling happens where there is no signal,
so capture must be instant and durable and sync must never lose an observation
(§34, invariant #4).

## What's in this package

Two layers, deliberately split so the hard part is testable in Node:

- **`src/` — device glue (typed + unit-tested, builds with the repo tooling):**
  - `AsyncKvLocalStore` — a durable `LocalStore` (from `@jk/offline-sync`) over
    any `AsyncKv` (React Native's `AsyncStorage`, or an encrypted KV). Records
    survive app restarts because they're written before capture returns.
  - `HttpSyncTransport` — delivers captured observations to the platform's
    idempotent `POST /api/v1/device-observations:batch`, mapping the 207
    per-observation result to the engine's accepted/retryable/rejected outcomes.
  - `CaptureController` — the headless view-model the screens bind to:
    `captureWeight()` (offline-safe, instant), `sync()`, `status()`.

- **`ui/` — React Native screens (built with the RN toolchain, not the repo
  tsc/eslint):** `CaptureScreen` and `App` wire `AsyncStorage` + the API client
  into the controller. Excluded from `pnpm typecheck` / `pnpm lint` because they
  need the React Native types and Metro bundler.

## Why the split

The offline correctness (never lose, at-least-once, idempotent, crash-safe,
backoff) lives in `@jk/offline-sync` and this package's `src/` glue, all of
which run and are tested in Node/CI. The RN `ui/` layer is thin presentation
that only compiles on a machine with the React Native toolchain and an
emulator/device — so it is kept out of the headless build gates.

## Running the app (on a machine with the RN toolchain)

```bash
# from apps/mobile, after `pnpm install` at the repo root
npx react-native run-android   # or run-ios
```

Requires `react-native` and `@react-native-async-storage/async-storage` (added
by the RN project template; not installed in the headless workspace).

## Tests

```bash
pnpm --filter @jk/mobile test:unit
```

Covers the KV store as a `LocalStore` driving the sync engine, the transport's
207→outcome mapping (accepted/duplicate/pending_resolution → accepted;
rejected_validation → rejected; else retryable; missing result → retryable), and
the controller's offline-capture → reconnect → sync flow, including parking a
rejected capture for review instead of dropping it.
