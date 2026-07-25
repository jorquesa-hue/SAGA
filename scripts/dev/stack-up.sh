#!/usr/bin/env bash
# One-command local stack: infra + migrate/seed + api + worker + edge-gateway +
# web. Brings everything up, seeded, in the right order (the `app` profile
# includes the migrate init that api/worker wait on).
#
#   scripts/dev/stack-up.sh          # build + up -d, then print URLs
#   scripts/dev/stack-up.sh down     # tear down (keep volumes)
#   scripts/dev/stack-up.sh nuke     # tear down + remove volumes
set -euo pipefail
cd "$(dirname "$0")/../.."
COMPOSE="docker compose -f infrastructure/compose/docker-compose.yml"

case "${1:-up}" in
  down) exec $COMPOSE --profile app down ;;
  nuke) exec $COMPOSE --profile app down -v ;;
esac

# Base infra first (healthchecks gate the app tier), then the app profile.
$COMPOSE up -d postgres redis nats minio otel-collector
$COMPOSE --profile app up -d --build

cat <<'URLS'

SAGA is starting. Once healthy:
  Web console   http://localhost:8080
  API           http://localhost:4000  (health: /health/live)
  Worker        http://localhost:4100/health/live
  Edge gateway  http://localhost:4200/status

Sign in to the console with the seeded reference farm:
  User ID    00000000-0000-4000-8000-000000000021   (tenant_owner)
  Tenant ID  00000000-0000-4000-8000-000000000001
URLS
