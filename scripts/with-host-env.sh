#!/usr/bin/env sh
set -eu

# Superuser MIGRATION_DATABASE_URL is for CREATE ROLE / CREATE DATABASE / GRANT / migrate / migrate:fresh DROP.
# HiroApp HTTP uses APP_DATABASE_URL (strata_app, NOSUPERUSER NOBYPASSRLS) on hiroapp_test.
# Fixture DATABASE_URL is fixture admin for bun_testing_test (migrate:fresh DROP). It is not HiroApp HTTP.
export POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-dev-postgres-change-me}"
export STRATA_APP_PASSWORD="${STRATA_APP_PASSWORD:-dev-strata-app-change-me}"
export DATABASE_URL="${DATABASE_URL:-postgresql://postgres:${POSTGRES_PASSWORD}@localhost:54329/bun_testing_test}"
export MIGRATION_DATABASE_URL="${MIGRATION_DATABASE_URL:-postgresql://postgres:${POSTGRES_PASSWORD}@localhost:54329/hiroapp_test}"
export APP_DATABASE_URL="${APP_DATABASE_URL:-postgresql://strata_app:${STRATA_APP_PASSWORD}@localhost:54329/hiroapp_test}"
export REDIS_URL="${REDIS_URL:-redis://:dev-redis-change-me@localhost:6379}"
export MYSQL_URL="${MYSQL_URL:-mysql://strata:dev-mysql-change-me@localhost:33061/strata}"
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
