#!/usr/bin/env bun
/** Remove duplicate monorepo layers accidentally emitted into @getstrata/bootstrap/dist. */

import { rm } from "node:fs/promises";
import { join } from "node:path";

const BOOTSTRAP_DIST = join(import.meta.dir, "../packages/strata-bootstrap/dist");

const PRUNE_TOP_LEVEL = [
  "cli",
  "config",
  "core",
  "db",
  "domain",
  "framework",
  "modules",
  "types",
] as const;

for (const directory of PRUNE_TOP_LEVEL) {
  await rm(join(BOOTSTRAP_DIST, directory), { recursive: true, force: true });
}

console.log(`Pruned ${PRUNE_TOP_LEVEL.length} duplicate directories from bootstrap dist.`);
