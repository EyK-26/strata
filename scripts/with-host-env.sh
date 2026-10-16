#!/usr/bin/env sh
set -eu

# Superuser MIGRATION_DATABASE_URL is for CREATE ROLE / CREATE DATABASE / GRANT / migrate / migrate:fresh DROP.
# Generated HTTP fixtures use restricted APP_DATABASE_URL credentials (strata_app, NOSUPERUSER NOBYPASSRLS).
# hiroapp_test remains a local credential-source name; acceptance creates owned databases.
# Fixture DATABASE_URL is fixture admin for bun_testing_test (migrate:fresh DROP). It is not an HTTP runtime credential.
export POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-dev-postgres-change-me}"
export STRATA_APP_PASSWORD="${STRATA_APP_PASSWORD:-dev-strata-app-change-me}"
export DATABASE_URL="${DATABASE_URL:-postgresql://postgres:${POSTGRES_PASSWORD}@localhost:54329/bun_testing_test}"
export MIGRATION_DATABASE_URL="${MIGRATION_DATABASE_URL:-postgresql://postgres:${POSTGRES_PASSWORD}@localhost:54329/hiroapp_test}"
export APP_DATABASE_URL="${APP_DATABASE_URL:-postgresql://strata_app:${STRATA_APP_PASSWORD}@localhost:54329/hiroapp_test}"
export REDIS_URL="${REDIS_URL:-redis://:dev-redis-change-me@localhost:6379}"
export MYSQL_OBSERVABILITY_ADMIN_URL="${MYSQL_OBSERVABILITY_ADMIN_URL:-mysql://root:dev-mysql-change-me@localhost:33061/mysql}"
export MYSQL_URL="${MYSQL_URL:-mysql://strata:dev-mysql-change-me@localhost:33061/strata}"
export PORT="${PORT:-3000}"
export CACHE_DRIVER="${CACHE_DRIVER:-redis}"
export QUEUE_DRIVER="${QUEUE_DRIVER:-sync}"
# Host tests have no SMTP server; log unless the caller configured another transport.
export MAIL_DRIVER="${MAIL_DRIVER:-log}"
export APP_KEY_PREFIX="${APP_KEY_PREFIX:-strata}"
export APP_NAME="${APP_NAME:-Strata}"
# Local fixture-only cookie secret; generated acceptance owns its runtime configuration.
export SESSION_SECRET="${SESSION_SECRET:-dev-session-secret-change-me-please-32ch}"

exec "$@"
