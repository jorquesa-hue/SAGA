# Deployment

Container images and a one-command local stack for JK Platform. All images
build from the **repository root** (the pnpm workspace root) and bake **no
secrets** — configuration is injected at runtime (Appendix G).

## Images (`infrastructure/docker/`)

| image | Dockerfile | serves |
| --- | --- | --- |
| `jk-api` | `Dockerfile.api` | Fastify API, `:4000`, `/health/live` |
| `jk-worker` | `Dockerfile.worker` | outbox relay + projections, `:4100` |
| `jk-edge-gateway` | `Dockerfile.edge-gateway` | on-farm device ingest, `:4200`, durable `/data` volume |
| `jk-web` | `Dockerfile.web` | nginx serving the SPA + proxying `/api`, `:8080` |
| `jk-migrate` | `Dockerfile.migrate` | one-shot roles+migrations+seed, then exits |

Each long-running image runs as non-root (uid 10001) with a `HEALTHCHECK`.
The API/worker/edge images use a cached multi-stage pnpm build and a pruned
`pnpm deploy --prod` runtime tree.

## One-command local stack

```bash
scripts/dev/stack-up.sh          # build + start infra, migrate/seed, and all apps
scripts/dev/stack-up.sh down     # stop (keep data)
scripts/dev/stack-up.sh nuke     # stop + delete volumes
```

The compose `app` profile includes a `migrate` init service that applies
roles + migrations and loads the synthetic reference farm; `api` and `worker`
wait for it via `service_completed_successfully`, so a single `up` reaches a
ready, seeded state. Then:

- Web console → <http://localhost:8080> (sign in with the seeded owner
  `00000000-0000-4000-8000-000000000021` / tenant
  `00000000-0000-4000-8000-000000000001`)
- API → <http://localhost:4000>, Worker → `:4100`, Edge gateway → `:4200/status`

## CORS

The API enables CORS via `@fastify/cors` (§46). `CORS_ORIGINS` is a
comma-separated allowlist of browser origins. Empty in production means
same-origin only; in local dev, empty reflects the request origin so the Vite
dev server works. In the composed stack the web container proxies `/api`
same-origin, so no cross-origin access is needed there.

## Database connections (two by design, §67)

- `DATABASE_URL` — owner/system connection, used only for tenant onboarding.
- `APP_DATABASE_URL` — RLS-enforced `jk_app` connection for all tenant work.

The worker uses its own least-privilege `jk_worker` role
(`WORKER_DATABASE_URL`); the edge gateway authenticates as a tenant device
(dev user id locally, bearer token in production).

## Production notes

- Terminate TLS at the ingress; set `CORS_ORIGINS` to the console's real
  origin if it is hosted separately from the API.
- Mount a persistent volume at the edge gateway's `/data` so its buffer
  survives restarts; swap the file buffer for a SQLite adapter at high volume.
- At-rest encryption for export artifacts/attachments is the storage layer's
  responsibility (object-store SSE / encrypted volumes) — see
  `docs/operations/production-hardening.md`.
