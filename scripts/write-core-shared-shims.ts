#!/usr/bin/env bun
/** Write thin dist/entries/*.js shims that re-export the main @getstrata/core bundle. */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { CORE_SHARED_SUBPATHS } from "./core-shared-subpaths.ts";

const packageDir = join(import.meta.dir, "../packages/strata-core");

function sharedShimImportPath(subpath: string): string {
  const depth = subpath.split("/").length;
  return `${"../".repeat(depth)}index.js`;
}

for (const subpath of CORE_SHARED_SUBPATHS) {
  const outputPath = join(packageDir, "dist/entries", `${subpath}.js`);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `export * from "${sharedShimImportPath(subpath)}";\n`, "utf8");
}

console.log(`Wrote ${CORE_SHARED_SUBPATHS.length} shared @getstrata/core subpath shims.`);
