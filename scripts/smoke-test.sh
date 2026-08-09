#!/usr/bin/env sh
set -eu

exec bun "$(dirname "$0")/smoke-test.ts"
