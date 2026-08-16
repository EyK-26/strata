#!/usr/bin/env bun
/** Fail when application source imports shared barrel subpaths instead of granular paths. */

import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dir, "..");
const SCAN_ROOTS = [
  join(ROOT, "src"),
  join(ROOT, "tests"),
  join(ROOT, "packages/strata-starter/templates/src"),
  join(ROOT, "..", "getstrata", "src"),
];

const BARREL_IMPORT =
  /import\s+(?:type\s+)?\{[^}]+\}\s+from\s+["']@getstrata\/core\/(?:database|http)["']/g;

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") {
        continue;
      }
      files.push(...(await walk(path)));
      continue;
    }

    if (entry.name.endsWith(".ts")) {
      files.push(path);
    }
  }

  return files;
}

const errors: string[] = [];

for (const scanRoot of SCAN_ROOTS) {
  let files: string[] = [];
  try {
    files = await walk(scanRoot);
  } catch {
    continue;
  }

  for (const filePath of files) {
    const relativePath = relative(ROOT, filePath).replace(/\\/g, "/");
    if (
      relativePath === "src/core/http/index.ts" ||
      relativePath === "src/framework/public-api.ts"
    ) {
      continue;
    }

    const source = await readFile(filePath, "utf8");
    for (const match of source.matchAll(BARREL_IMPORT)) {
      const barrel = match[0].includes("/database")
        ? "@getstrata/core/database"
        : "@getstrata/core/http";
      errors.push(`${relativePath}: use granular ${barrel}/* subpaths instead of ${barrel} barrel`);
    }
  }
}

if (errors.length > 0) {
  console.error(`Shared barrel imports found:\n${errors.map((entry) => `- ${entry}`).join("\n")}`);
  process.exit(1);
}

console.log("No disallowed shared barrel imports in application source.");
