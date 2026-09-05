#!/usr/bin/env bash
set -euo pipefail

cd /app

bun install
bun install --cwd frontend

if [ "${FRONTEND_MODE:-hybrid}" = "spa-react" ] || [ "${FRONTEND_MODE:-hybrid}" = "hybrid" ]; then
  bun run frontend:build
fi

exec "$@"
