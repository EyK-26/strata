#!/usr/bin/env bun
/** Fail when application source imports the @getstrata/core root entry instead of subpaths. */

import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dir, "..");
const SCAN_ROOTS = [
  join(ROOT, "src"),
  join(ROOT, "packages/strata-starter/templates/src"),
  join(ROOT, "..", "getstrata", "src"),
];

const ALLOWLIST = new Set(["src/framework/public-api.ts"]);

const ROOT_IMPORT = /from\s+["']@getstrata\/core["']/;

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
    if (ALLOWLIST.has(relativePath)) {
      continue;
    }

    const source = await readFile(filePath, "utf8");
    if (ROOT_IMPORT.test(source)) {
      errors.push(relativePath);
    }
  }
}

if (errors.length > 0) {
  console.error(
    `Root @getstrata/core imports are not allowed in application source:\n${errors.map((file) => `- ${file}`).join("\n")}`,
  );
  process.exit(1);
}

console.log(
  `No root @getstrata/core imports in application source (${SCAN_ROOTS.length} trees scanned).`,
);
