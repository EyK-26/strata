#!/usr/bin/env sh
set -eu

ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
FAILED=0

echo "Scanning for default WorkHub credential literals outside approved paths..."

PATTERN='workhub-(admin|member|scim)-test-token'

if rg -n \
  --glob '!.env*' \
  --glob '!scripts/security-scan.sh' \
  --glob '!tests/**' \
  --glob '!src/domain/**' \
  --glob '!src/db/seeders/**' \
  --glob '!docs/**' \
  --glob '!DEPLOY.md' \
  --glob '!RUNBOOK.md' \
  "${PATTERN}" \
  "${ROOT}" >/tmp/workhub-secret-scan.txt 2>/dev/null; then
  echo "Default credential literals found outside approved paths:" >&2
  cat /tmp/workhub-secret-scan.txt >&2
  FAILED=1
else
  echo "No default credential literals detected outside approved paths."
fi

if [ "${FAILED}" -ne 0 ]; then
  exit 1
fi

echo "Security scan passed."
