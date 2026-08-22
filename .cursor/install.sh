#!/usr/bin/env bash
# Cloud Agent install phase for WorkHub (Strata).
#
# Idempotent one-time setup that is captured in the environment snapshot:
#   - Bun 1.4.0 (pinned)
#   - PostgreSQL 18 (host-native, listening on 54329 to match repo defaults)
#   - Redis (host-native, port 6379)
#   - JS dependencies (frozen lockfile)
#   - Database schema + seed data (migrate:fresh --seed)
#
# Per-boot service startup lives in .cursor/start.sh.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${REPO_ROOT}"

BUN_VERSION=1.4.0
PG_VERSION=18
PG_PORT=54329

export DEBIAN_FRONTEND=noninteractive

echo "=== [1/6] Install Bun ${BUN_VERSION} ==="
if [ ! -x "${HOME}/.bun/bin/bun" ] || [ "$(${HOME}/.bun/bin/bun --version 2>/dev/null || true)" != "${BUN_VERSION}" ]; then
  curl -fsSL https://bun.sh/install | bash -s "bun-v${BUN_VERSION}"
fi
sudo ln -sf "${HOME}/.bun/bin/bun" /usr/local/bin/bun
sudo ln -sf "${HOME}/.bun/bin/bunx" /usr/local/bin/bunx
export PATH="${HOME}/.bun/bin:${PATH}"
bun --version

echo "=== [2/6] Install PostgreSQL ${PG_VERSION} + Redis ==="
sudo apt-get update -qq
sudo apt-get install -y -qq curl ca-certificates gnupg lsb-release

if ! dpkg -s "postgresql-${PG_VERSION}" >/dev/null 2>&1; then
  sudo install -d /usr/share/postgresql-common/pgdg
  sudo curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
    -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
  echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" \
    | sudo tee /etc/apt/sources.list.d/pgdg.list >/dev/null
  sudo apt-get update -qq
fi
sudo apt-get install -y -qq "postgresql-${PG_VERSION}" "postgresql-client-${PG_VERSION}" redis-server

echo "=== [3/6] Configure PostgreSQL cluster (port ${PG_PORT}, password auth) ==="
PG_CONF_DIR="/etc/postgresql/${PG_VERSION}/main"
sudo tee "${PG_CONF_DIR}/conf.d/cloud-agent.conf" >/dev/null <<EOF
port = ${PG_PORT}
listen_addresses = 'localhost'
password_encryption = scram-sha-256
EOF
# Password auth for host-native Bun processes (TCP localhost only).
if ! sudo grep -q "Cloud Agent: password auth" "${PG_CONF_DIR}/pg_hba.conf"; then
  sudo tee -a "${PG_CONF_DIR}/pg_hba.conf" >/dev/null <<'EOF'
# Cloud Agent: password auth for host bun processes
host    all             all             127.0.0.1/32            scram-sha-256
host    all             all             ::1/128                 scram-sha-256
EOF
fi

echo "=== [4/6] Start services ==="
# shellcheck source=/dev/null
source "${REPO_ROOT}/.cursor/services.sh"

echo "=== [5/6] Provision role + database ==="
sudo -u postgres psql -p "${PG_PORT}" -c "ALTER USER postgres PASSWORD 'postgres';"
if ! sudo -u postgres psql -p "${PG_PORT}" -tAc "SELECT 1 FROM pg_database WHERE datname='bun_testing_test'" | grep -q 1; then
  sudo -u postgres createdb -p "${PG_PORT}" bun_testing_test
fi

echo "=== [6/6] Install JS dependencies + migrate & seed ==="
export DATABASE_URL="postgresql://postgres:postgres@localhost:${PG_PORT}/bun_testing_test"
export REDIS_URL="redis://localhost:6379"

if ! bun install --frozen-lockfile; then
  echo "Frozen lockfile out of sync; falling back to 'bun install'." >&2
  bun install
fi

bun run cli migrate:fresh --seed

echo "=== Install complete ==="
