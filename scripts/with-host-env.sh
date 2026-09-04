#!/usr/bin/env sh
set -eu

# Use published Docker Compose ports when running Bun on the host machine.
export DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@localhost:54329/bun_testing_test}"
export REDIS_URL="${REDIS_URL:-redis://localhost:6379}"
export PORT="${PORT:-3000}"
export CACHE_DRIVER="${CACHE_DRIVER:-redis}"
export QUEUE_DRIVER="${QUEUE_DRIVER:-sync}"
export APP_KEY_PREFIX="${APP_KEY_PREFIX:-hiroapp}"
export APP_NAME="${APP_NAME:-HiroApp}"
export DOGFOOD_APP="${DOGFOOD_APP:-hiroapp}"

exec "$@"
