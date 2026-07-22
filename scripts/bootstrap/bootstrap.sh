#!/usr/bin/env bash
# One-command developer bootstrap (Phase 0 exit criterion: clean onboarding).
set -euo pipefail
cd "$(dirname "$0")/../.."

if [ ! -f .env ]; then
  cp .env.example .env
  echo "created .env from .env.example"
fi

pnpm install
pnpm build
pnpm db:migrate
pnpm db:seed
pnpm test:unit
echo ""
echo "Bootstrap complete. Start the API with: pnpm --filter @jk/api start"
