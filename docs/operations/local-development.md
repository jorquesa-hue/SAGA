# Operations — Local Development

## Prerequisites

- Node.js ≥ 22, pnpm ≥ 9
- PostgreSQL 16 with PostGIS (local install or `infrastructure/compose/`)

## One-command bootstrap

```bash
pnpm bootstrap        # installs, builds, migrates, seeds, runs unit tests
```

## Manual loop

```bash
cp .env.example .env
pnpm install
pnpm build
pnpm db:migrate                 # applies database/migrations to DATABASE_URL
pnpm db:seed                    # synthetic reference farm
pnpm test:unit                  # no external services
TEST_DATABASE_ADMIN_URL=postgresql://jk:jk@localhost:5432/postgres \
  pnpm test:integration         # disposable databases
TEST_DATABASE_ADMIN_URL=postgresql://jk:jk@localhost:5432/postgres \
  pnpm test:tenant-isolation    # cross-tenant attack suite
```

## Run the API

```bash
APP_ENV=local \
DATABASE_URL=postgresql://jk:jk@localhost:5432/jk_platform \
APP_DATABASE_URL=postgresql://jk_app:jk_app_local@localhost:5432/jk_platform \
pnpm --filter @jk/api start
curl localhost:4000/health/ready
```

Local dev auth (no OIDC): send `x-dev-user-id: <uuid>` and optionally
`x-dev-platform-admin: true`. Select a tenant with `x-tenant-id: <uuid>`.
Commands require an `Idempotency-Key` header.

## Run the worker

```bash
WORKER_DATABASE_URL=postgresql://jk_worker:jk_worker_local@localhost:5432/jk_platform \
pnpm --filter @jk/worker start          # LogPublisher by default; set NATS_URL for JetStream
```

## Quality gates (mirror CI)

```bash
pnpm lint
pnpm architecture:check
pnpm contracts:validate
pnpm db:migrate:test            # applies + verifies checksums from zero (TEST_DATABASE_URL)
```

## Compose services

`infrastructure/compose/docker-compose.yml` provides PostgreSQL/PostGIS, Redis,
NATS JetStream, MinIO, Keycloak, and an OTel collector for a full local stack
(requires Docker, not available in every environment).
