#!/usr/bin/env bun
/** Ensure shared subpath shims re-export the main @getstrata/core bundle. */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { CORE_SHARED_SUBPATHS } from "./core-shared-subpaths.ts";

const ROOT = join(import.meta.dir, "..");
const ENTRIES_DIR = join(ROOT, "packages/strata-core/dist/entries");
const CONSUMER_SCAN_ROOTS = [join(ROOT, "..", "getstrata", "src")];

const IMPORT_PATTERN =
  /import\s+(?!type\s)\{([^}]+)\}\s+from\s+["']@getstrata\/core\/([^"']+)["']/g;

const sharedSubpathSet = new Set<string>(CORE_SHARED_SUBPATHS);

function parseImportNames(specifier: string): string[] {
  return specifier
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !part.startsWith("type "))
    .map((part) => {
      const aliasMatch = part.match(/^(\w+)(?:\s+as\s+(\w+))?$/);
      return aliasMatch?.[2] ?? aliasMatch?.[1] ?? part;
    });
}

async function collectSourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") {
        continue;
      }
      files.push(...(await collectSourceFiles(fullPath)));
      continue;
    }

    if (/\.(?:ts|tsx)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

const requiredExports = new Map<string, Set<string>>();

for (const scanRoot of CONSUMER_SCAN_ROOTS) {
  let files: string[] = [];
  try {
    files = await collectSourceFiles(scanRoot);
  } catch {
    continue;
  }

  for (const filePath of files) {
    const source = await readFile(filePath, "utf8");

    for (const match of source.matchAll(IMPORT_PATTERN)) {
      const subpath = match[2]!;
      if (!sharedSubpathSet.has(subpath)) {
        continue;
      }

      const names = parseImportNames(match[1]!);
      const bucket = requiredExports.get(subpath) ?? new Set<string>();
      for (const name of names) {
        bucket.add(name);
      }
      requiredExports.set(subpath, bucket);
    }
  }
}

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

  const required = requiredExports.get(subpath);
  if (!required) {
    continue;
  }

  const shimModule = await import(shimPath);
  for (const exportName of required) {
    if (!(exportName in shimModule)) {
      errors.push(
        `Shared subpath @getstrata/core/${subpath} missing runtime export "${exportName}"`,
      );
    }
  }
}

if (errors.length > 0) {
  console.error(`Shared subpath verification failed:\n${errors.map((e) => `- ${e}`).join("\n")}`);
  process.exit(1);
}

const importCount = [...requiredExports.values()].reduce((sum, set) => sum + set.size, 0);
console.log(
  `Shared subpaths OK (${CORE_SHARED_SUBPATHS.length} shims, ${importCount} imported symbols verified).`,
);
