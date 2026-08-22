#!/usr/bin/env bash
# Shared helper: (re)start PostgreSQL and Redis and wait until both accept
# connections. Safe to run repeatedly (used by both install.sh and start.sh).
set -euo pipefail

PG_VERSION=18
PG_PORT="${PG_PORT:-54329}"
REDIS_PORT="${REDIS_PORT:-6379}"

start_postgres() {
  if sudo pg_isready -q -p "${PG_PORT}" -h localhost 2>/dev/null; then
    echo "PostgreSQL already accepting connections on ${PG_PORT}."
    return 0
  fi

  echo "Starting PostgreSQL cluster ${PG_VERSION}/main on port ${PG_PORT}..."
  sudo pg_ctlcluster "${PG_VERSION}" main start >/dev/null 2>&1 || true

  for _ in $(seq 1 30); do
    if sudo pg_isready -q -p "${PG_PORT}" -h localhost 2>/dev/null; then
      echo "PostgreSQL is ready on ${PG_PORT}."
      return 0
    fi
    sleep 1
  done

  echo "ERROR: PostgreSQL did not become ready on ${PG_PORT}." >&2
  sudo tail -n 40 "/var/log/postgresql/postgresql-${PG_VERSION}-main.log" 2>/dev/null || true
  return 1
}

start_redis() {
  if redis-cli -p "${REDIS_PORT}" ping 2>/dev/null | grep -q PONG; then
    echo "Redis already responding on ${REDIS_PORT}."
    return 0
  fi

  echo "Starting Redis on port ${REDIS_PORT}..."
  sudo redis-server /etc/redis/redis.conf --daemonize yes --port "${REDIS_PORT}" >/dev/null 2>&1 \
    || redis-server --daemonize yes --port "${REDIS_PORT}" >/dev/null 2>&1 || true

  for _ in $(seq 1 15); do
    if redis-cli -p "${REDIS_PORT}" ping 2>/dev/null | grep -q PONG; then
      echo "Redis is ready on ${REDIS_PORT}."
      return 0
    fi
    sleep 1
  done

  echo "ERROR: Redis did not become ready on ${REDIS_PORT}." >&2
  return 1
}

start_postgres
start_redis
