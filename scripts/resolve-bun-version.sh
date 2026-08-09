#!/usr/bin/env bash
# Print the Bun version to install from .bun-version.
# A trailing .x (1.4.x) resolves to the latest matching patch on GitHub.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FILE="${1:-${ROOT}/.bun-version}"
RANGE="$(tr -d ' \n' < "${FILE}")"

if [[ "${RANGE}" != *.x ]]; then
  printf '%s\n' "${RANGE}"
  exit 0
fi

MINOR="${RANGE%.x}"
TAGS="$(
  curl -fsSL -H "User-Agent: strata-resolve-bun" \
    "https://api.github.com/repos/oven-sh/bun/git/matching-refs/tags/bun-v${MINOR}."
)"
VERSION="$(
  printf '%s\n' "${TAGS}" \
    | grep -oE "bun-v${MINOR}\\.[0-9]+" \
    | sort -t. -k3,3n \
    | tail -1 \
    | sed 's/^bun-v//'
)"

if [[ -z "${VERSION}" ]]; then
  echo "Could not resolve latest Bun ${RANGE} from GitHub tags." >&2
  exit 1
fi

printf '%s\n' "${VERSION}"
