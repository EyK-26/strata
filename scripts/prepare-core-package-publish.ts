#!/usr/bin/env bun
/** Point @getstrata/core workspace exports at dist for npm publish. */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const packageJsonPath = join(import.meta.dir, "../packages/strata-core/package.json");
const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as {
  exports: Record<string, { import?: string; default?: string; types?: string }>;
};

const rootExport = packageJson.exports["."];
if (!rootExport) {
  throw new Error("@getstrata/core is missing a root export.");
}

rootExport.import = "./dist/index.js";
rootExport.default = "./dist/index.js";

await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");
console.log("Prepared @getstrata/core package exports for publish.");
