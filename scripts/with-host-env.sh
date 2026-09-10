#!/usr/bin/env sh
set -eu

# Use published Docker Compose ports when running Bun on the host machine.
export DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@localhost:54329/bun_testing_test}"
# HiroApp uses its own database so it never replaces the fixture tables in DATABASE_URL.
export APP_DATABASE_URL="${APP_DATABASE_URL:-postgresql://postgres:postgres@localhost:54329/hiroapp_test}"
export REDIS_URL="${REDIS_URL:-redis://localhost:6379}"
export MYSQL_URL="${MYSQL_URL:-mysql://strata:strata@localhost:33061/strata}"
export PORT="${PORT:-3000}"
export CACHE_DRIVER="${CACHE_DRIVER:-redis}"
export QUEUE_DRIVER="${QUEUE_DRIVER:-sync}"
# HiroApp's preload forces MAIL_DRIVER=smtp, which needs a MAIL_HOST. Host runs
# have no SMTP server, so log to stdout unless the caller asked for something else.
export MAIL_DRIVER="${MAIL_DRIVER:-log}"
export APP_KEY_PREFIX="${APP_KEY_PREFIX:-hiroapp}"
export APP_NAME="${APP_NAME:-HiroApp}"
export DOGFOOD_APP="${DOGFOOD_APP:-hiroapp}"
# HiroApp is a cookie app and refuses to boot without a session secret; this is the local dev value.
export SESSION_SECRET="${SESSION_SECRET:-dev-session-secret-change-me-please-32ch}"

exec "$@"
