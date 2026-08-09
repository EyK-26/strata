#!/usr/bin/env sh
set -eu

ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
FAILED=0

echo "Scanning for default published test credential literals outside approved paths..."

if ! command -v rg >/dev/null 2>&1; then
  echo "ripgrep (rg) is required for scripts/security-scan.sh" >&2
  exit 1
fi

PATTERN='strata-(admin|member|scim)-test-token'

if rg -n \
  --glob '!.env*' \
  --glob '!README.md' \
  --glob '!scripts/security-scan.sh' \
  --glob '!scripts/smoke-test.ts' \
  --glob '!scripts/load/**' \
  --glob '!tests/**' \
  --glob '!src/domain/**' \
  --glob '!src/bootstrap/secretsGuard.ts' \
  --glob '!src/db/seeders/**' \
  --glob '!docs/**' \
  --glob '!DEPLOY.md' \
  --glob '!RUNBOOK.md' \
  "${PATTERN}" \
  "${ROOT}" >/tmp/strata-secret-scan.txt 2>/dev/null; then
  echo "Default credential literals found outside approved paths:" >&2
  cat /tmp/strata-secret-scan.txt >&2
  FAILED=1
else
  echo "No default credential literals detected outside approved paths."
fi

if [ "${FAILED}" -ne 0 ]; then
  exit 1
fi

echo "Security scan passed."
