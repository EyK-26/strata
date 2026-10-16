#!/usr/bin/env bun
/** Write thin dist/entries/*.js shims that re-export the main @getstrata/core bundle. */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { CORE_SHARED_SUBPATHS, renderCoreSharedShim } from "./core-shared-subpaths.ts";

const packageDir = join(import.meta.dir, "../packages/strata-core");

for (const subpath of CORE_SHARED_SUBPATHS) {
  const outputPath = join(packageDir, "dist/entries", `${subpath}.js`);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, renderCoreSharedShim(subpath), "utf8");
}

console.log(`Wrote ${CORE_SHARED_SUBPATHS.length} shared @getstrata/core subpath shims.`);
