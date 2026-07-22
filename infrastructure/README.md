# infrastructure/

Deployment and local-environment baselines for JK Platform per
**JK-PLT-EES-001** §30 (Container Architecture), §75 (Infrastructure
Baseline), §76 (Kubernetes Baseline), §77 (Observability), and Appendix H.

## Layout

| Path                             | Purpose                                                                                                                                 |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `docker/`                        | Multi-stage pnpm images for `@jk/api` (port 4000) and `@jk/worker` (port 4100) — Appendix H.1 pattern, non-root uid 10001, HEALTHCHECK. |
| `compose/docker-compose.yml`     | Local development stack — Appendix H.2.                                                                                                 |
| `helm/jk-api/`                   | Kubernetes chart for the API — §76 / Appendix H.3.                                                                                      |
| `terraform/modules/jk-platform/` | Provider-neutral infrastructure contract — §75 / Appendix H.4 (see its README re: ADR-001).                                             |
| `terraform/environments/local/`  | Canonical module consumption stack.                                                                                                     |
| `observability/`                 | OTel collector config + §77 indicator inventory.                                                                                        |

## Local compose ↔ Phase 0 dev loop

From the repository root:

```bash
# 1. Start backing services (Postgres+PostGIS, Redis, NATS JetStream,
#    MinIO, Keycloak dev, OTel collector):
docker compose -f infrastructure/compose/docker-compose.yml up -d \
  postgres redis nats minio keycloak otel-collector

# 2. Provision roles + schema + synthetic reference farm (Fazenda Boa
#    Esperança, Brangus herd — never production data):
pnpm db:migrate          # applies database/migrations + policies
pnpm db:seed

# 3. Develop against the stack:
pnpm build && pnpm test:unit
TEST_DATABASE_URL=postgresql://jk:jk@localhost:5432/postgres pnpm test:integration
pnpm test:tenant-isolation

# 4. Or run the containerized services themselves:
docker compose -f infrastructure/compose/docker-compose.yml up -d --build api worker
curl -fsS http://localhost:4000/health/live   # api
curl -fsS http://localhost:4100/health/live   # worker
```

Service endpoints on the host:

| Service                 | Endpoint                                                  | Notes                                                                                                                          |
| ----------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| PostgreSQL 16 + PostGIS | `localhost:5432`                                          | superuser `jk`/`jk`, db `jk_platform`; app roles `jk_app`/`jk_worker` provisioned by `database/policies/application_roles.sql` |
| Redis                   | `localhost:6379`                                          | cache/locks/queues only — never sole business storage                                                                          |
| NATS JetStream          | `localhost:4222` (monitor `:8222`)                        | durable domain events                                                                                                          |
| MinIO (S3)              | `localhost:9000` (console `:9001`)                        | attachments, signed URLs                                                                                                       |
| Keycloak (dev mode)     | `localhost:8080` (mgmt `:9080`)                           | OIDC dev provider; realm bootstrap manual until ADR-002                                                                        |
| OTel collector          | OTLP `:4317`/`:4318`, Prometheus `:8889`, health `:13133` | see `observability/`                                                                                                           |
| API / Worker            | `:4000` / `:4100`                                         | health at `/health/live`, `/health/ready` (API adds `/health/startup`)                                                         |

All credentials in the compose file are synthetic local-development values;
no production secret ever appears in this repository. Runtime configuration
is injected from a git-ignored root `.env` (Appendix G typed configuration —
services fail startup on invalid critical configuration).

## What is deferred, and to which ADR

| Deferred item                                                                                                                        | Blocking decision                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| Terraform provider bindings (VPC, managed PG, broker, registry, secrets, observability vendor, backup vault, CI federation, budgets) | **ADR-001** cloud provider and primary region                                                       |
| Managed identity provider + Keycloak realm/client bootstrap automation                                                               | **ADR-002** managed identity provider                                                               |
| Kubernetes vs managed serverless containers; cluster provisioning                                                                    | **ADR-003** (with ADR-001)                                                                          |
| NATS JetStream hosting model (managed vs operator-managed)                                                                           | **ADR-004**                                                                                         |
| Compose services for sync, web, edge-gateway + device simulators                                                                     | land with their apps in later phases (Volume XII); Appendix H.2 lists them for the full local stack |
| Helm charts for web, workers, sync, AI, edge management; ingress/TLS manifests; HPA; migration/cron jobs                             | follow the jk-api chart pattern as those services land (§76)                                        |
| Dashboards + alert rules for the §77 indicator set                                                                                   | Phase 1 — inventory in `observability/README.md`                                                    |

## Production posture already encoded

- Images: build once, promote by immutable digest (`helm/jk-api` refuses to
  render without `image.digest`; Appendix I).
- Pods: non-root (uid 10001), read-only root filesystem, all capabilities
  dropped, seccomp `RuntimeDefault`, default-deny NetworkPolicy with an
  explicit ingress-nginx/postgres/nats/redis allowlist, PDB, topology
  spread (§76).
- Terraform: validated inputs, secure defaults (PITR/WAF/audit forced on in
  production), governance tags, no secrets in outputs (§75, §78, H.4).
