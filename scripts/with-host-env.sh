#!/usr/bin/env sh
set -eu

# Use published Docker Compose ports when running Bun on the host machine.
export DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@localhost:54329/bun_testing_test}"
export REDIS_URL="${REDIS_URL:-redis://localhost:6379}"
export CACHE_DRIVER="${CACHE_DRIVER:-redis}"
export QUEUE_DRIVER="${QUEUE_DRIVER:-sync}"

exec "$@"
