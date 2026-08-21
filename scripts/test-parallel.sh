#!/usr/bin/env sh
set -eu

export BUNFIG="${BUNFIG:-$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)/bunfig.parallel.toml}"
export CACHE_DRIVER="${CACHE_DRIVER:-array}"
export QUEUE_DRIVER="${QUEUE_DRIVER:-sync}"

exec bun test --parallel --isolate \
  tests/unit/imageTransform.test.ts \
  tests/unit/osCron.test.ts \
  tests/unit/runShell.test.ts \
  tests/unit/webViewSmoke.test.ts \
  tests/unit/bun14Features.test.ts
