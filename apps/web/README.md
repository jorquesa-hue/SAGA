# JK Platform — Web Console (`@jk/web`)

React + Vite single-page console (Volume V) that consumes the platform API
through the typed `@jk/contracts-rest` client. First slice covers the app
shell, a tenant-scoped session, and three real features.

## Features (F2 slice)

- **Session** — dev sign-in (user id + tenant id) matching the API's local dev
  auth; persisted to `localStorage`; the seam an OIDC redirect replaces in
  non-local environments. Every request is tenant-scoped and idempotent via the
  typed client.
- **Painel executivo** — reads the Farm Intelligence executive dashboard (§59).
- **Animais** — animal registry list with one-click traceability packet export
  (JK-ANI-006): request → process → QR-resolvable download link.
- **Recomendações de IA** — governed-AI review queue (§61–§64): risk and
  prohibited/high-impact badges; approval is a deliberate human action and is
  disabled for prohibited proposals (the block is enforced server-side too).

## Commands

```bash
pnpm --filter @jk/web dev        # Vite dev server (default :5173)
pnpm --filter @jk/web build      # tsc typecheck + vite production build
pnpm --filter @jk/web test:unit  # component tests (vitest + testing-library)
```

Configure the API origin with `VITE_API_BASE_URL` (default
`http://localhost:4000`).

## Notes

- As a static SPA the console has no server health endpoint; liveness/readiness
  are the static host's concern. The build output (`dist/`) is a set of static
  assets deployable to any CDN/object host.
- Component tests inject a fake-fetch `JkPlatformClient` via the
  `SessionProvider` `clientFactory` seam — no network, deterministic.
