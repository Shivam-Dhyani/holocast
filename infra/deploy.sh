#!/usr/bin/env bash
# Holocast deploy (TDD §4.5): pull, install, build, migrate, restart services.
# Run from the repo checkout at /opt/holocast as a user who can restart services.
set -euo pipefail

cd "$(dirname "$0")/.."

echo "=== git pull ==="
git pull --ff-only

echo "=== install (frozen lockfile) ==="
corepack pnpm install --frozen-lockfile

echo "=== build ==="
corepack pnpm build

echo "=== prisma migrate deploy ==="
corepack pnpm --filter @holocast/api prisma:generate
corepack pnpm --filter @holocast/api prisma:migrate:deploy

echo "=== restart services ==="
sudo systemctl restart holocast-api.service holocast-worker.service holocast-web.service
sudo systemctl --no-pager status holocast-api.service holocast-web.service holocast-worker.service | sed -n '1,12p'

echo "=== health ==="
sleep 2
curl -fsS "http://127.0.0.1:4000/api/health" || echo "health check failed"
echo
echo "Deploy complete."
