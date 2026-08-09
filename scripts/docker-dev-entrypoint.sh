#!/bin/sh
set -e

install_dependencies() {
  if bun install --frozen-lockfile; then
    return 0
  fi

  echo ""
  echo "Lockfile out of sync with package.json — running 'bun install' to update it."
  echo "If dependencies changed, commit the updated bun.lock before pushing."
  echo ""
  bun install
}

install_dependencies
exec "$@"
