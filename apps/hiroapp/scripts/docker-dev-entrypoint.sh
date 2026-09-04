#!/usr/bin/env bash
set -euo pipefail

cd /app

bun install
bun install --cwd frontend

if [ "${FRONTEND_MODE:-spa-react}" = "server-htmx" ]; then
  bun run assets:css
else
  bun run frontend:build
fi

exec "$@"
