#!/usr/bin/env bash
# Cloud Agent per-boot startup for Strata.
#
# Runs on every environment boot: (re)starts PostgreSQL + Redis and applies any
# pending migrations. Dependencies and the base schema/seed are provisioned once
# in .cursor/install.sh and preserved in the snapshot, so this stays fast and
# never wipes data.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${REPO_ROOT}"

export PATH="${HOME}/.bun/bin:${PATH}"
export DATABASE_URL="postgresql://postgres:postgres@localhost:54329/bun_testing_test"
export REDIS_URL="redis://localhost:6379"

# shellcheck source=/dev/null
source "${REPO_ROOT}/.cursor/services.sh"

# Idempotent: applies only outstanding migrations, no-op on a seeded snapshot.
bun run cli migrate

echo "Strata services ready (PostgreSQL :54329, Redis :6379)."
