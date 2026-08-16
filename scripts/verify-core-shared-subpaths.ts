#!/usr/bin/env bun
/** Ensure shared subpath shims re-export the main @getstrata/core bundle. */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { CORE_SHARED_SUBPATHS } from "./core-shared-subpaths.ts";

const ENTRIES_DIR = join(import.meta.dir, "../packages/strata-core/dist/entries");

const errors: string[] = [];

for (const subpath of CORE_SHARED_SUBPATHS) {
  const shimPath = join(ENTRIES_DIR, `${subpath}.js`);
  let shimSource: string;

  try {
    shimSource = await readFile(shimPath, "utf8");
  } catch {
    errors.push(`Missing built shim: dist/entries/${subpath}.js (run build:framework first)`);
    continue;
  }

  const depth = subpath.split("/").length;
  const expectedImport = `${"../".repeat(depth)}index.js`;

  if (!shimSource.includes(`export * from "${expectedImport}"`)) {
    errors.push(`Shim dist/entries/${subpath}.js does not re-export ${expectedImport}`);
  }

  if (shimSource.includes("class ValidationError")) {
    errors.push(
      `Shim dist/entries/${subpath}.js bundles ValidationError instead of re-exporting index`,
    );
  }
}

if (errors.length > 0) {
  console.error(`Shared subpath verification failed:\n${errors.map((e) => `- ${e}`).join("\n")}`);
  process.exit(1);
}

console.log(`Shared subpaths OK (${CORE_SHARED_SUBPATHS.length} shims verified).`);
