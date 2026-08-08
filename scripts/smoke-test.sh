#!/usr/bin/env sh
set -eu

BASE_URL="${BASE_URL:-http://localhost:3000}"
API_PREFIX="${API_PREFIX:-/api/v1}"
ADMIN_TOKEN="${ADMIN_API_TOKEN:-workhub-admin-test-token}"

curl -fsS "${BASE_URL}/health" >/dev/null
curl -fsS "${BASE_URL}/ready" >/dev/null
curl -fsS "${BASE_URL}/metrics" >/dev/null

curl -fsS -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  "${BASE_URL}${API_PREFIX}/auth/me" >/dev/null

curl -fsS "${BASE_URL}${API_PREFIX}/organizations" >/dev/null

echo "Smoke tests passed against ${BASE_URL}"
