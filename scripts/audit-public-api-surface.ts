#!/usr/bin/env bun
/** Report @getstrata/core root exports that have no references from application source. */

import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dir, "..");
const PUBLIC_API_PATH = join(ROOT, "src/framework/public-api.ts");
const SCAN_ROOTS = [
  join(ROOT, "src"),
  join(ROOT, "tests"),
  join(ROOT, "packages/strata-starter/templates/src"),
  join(ROOT, "..", "getstrata", "src"),
];

const ROOT_IMPORT = /import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+["']@getstrata\/core["']/g;
const ROOT_NAMESPACE = /import\s+\*\s+as\s+(\w+)\s+from\s+["']@getstrata\/core["']/g;

function parseExportNames(source: string): string[] {
  const names = new Set<string>();

  for (const match of source.matchAll(/^export\s+\{([^}]+)\}/gm)) {
    for (const part of match[1]!.split(",")) {
      const trimmed = part.trim();
      if (!trimmed || trimmed.startsWith("type ")) {
        continue;
      }
      const aliasMatch = trimmed.match(/(?:type\s+)?(\w+)(?:\s+as\s+(\w+))?$/);
      if (aliasMatch) {
        names.add(aliasMatch[2] ?? aliasMatch[1]!);
      }
    }
  }

  return [...names];
}

function parseImportedRootSymbols(source: string): Set<string> {
  const symbols = new Set<string>();

  for (const match of source.matchAll(ROOT_IMPORT)) {
    for (const part of match[1]!.split(",")) {
      const trimmed = part.trim().replace(/^type\s+/, "");
      const aliasMatch = trimmed.match(/^(\w+)(?:\s+as\s+(\w+))?$/);
      if (aliasMatch) {
        symbols.add(aliasMatch[2] ?? aliasMatch[1]!);
      }
    }
  }

  for (const match of source.matchAll(ROOT_NAMESPACE)) {
    symbols.add(`*:${match[1]!}`);
  }

  return symbols;
}

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

const publicApiSource = await readFile(PUBLIC_API_PATH, "utf8");
const exported = parseExportNames(publicApiSource);
const referenced = new Set<string>();

for (const scanRoot of SCAN_ROOTS) {
  let files: string[] = [];
  try {
    files = await walk(scanRoot);
  } catch {
    continue;
  }

  for (const filePath of files) {
    if (relative(ROOT, filePath).replace(/\\/g, "/") === "src/framework/public-api.ts") {
      continue;
    }

    const source = await readFile(filePath, "utf8");
    for (const symbol of parseImportedRootSymbols(source)) {
      referenced.add(symbol);
    }
  }
}

const unusedAtRoot = exported.filter(
  (name) => !referenced.has(name) && !referenced.has(`*:${name}`),
);

console.log(
  `Public API surface: ${exported.length} value exports, ${referenced.size} root-import symbols referenced in apps/tests.`,
);
if (unusedAtRoot.length > 0) {
  console.log(`Root exports with no in-repo @getstrata/core imports (${unusedAtRoot.length}):`);
  for (const name of unusedAtRoot.sort()) {
    console.log(`- ${name}`);
  }
}
