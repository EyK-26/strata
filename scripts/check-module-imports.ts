#!/usr/bin/env bun
/**
 * CI gate: fail if application code reaches framework sources via relative paths
 * instead of `@getstrata/core` / `@getstrata/bootstrap` subpaths.
 */

import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

const HIROAPP_ROOT = join(import.meta.dir, "../apps/hiroapp/src");
const violations: string[] = [];

async function walk(dir: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") {
        continue;
      }
      files.push(...(await walk(fullPath)));
      continue;
    }
    if (entry.name.endsWith(".ts")) {
      files.push(fullPath);
    }
  }
  return files;
}

function record(fullPath: string, index: number, line: string) {
  violations.push(
    `${relative(join(import.meta.dir, ".."), fullPath)}:${index + 1}: ${line.trim()}`,
  );
}

try {
  for (const filePath of await walk(HIROAPP_ROOT)) {
    const lines = (await readFile(filePath, "utf8")).split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? "";
      if (/from\s+['"](?:\.\.\/)+src\/(?:core|bootstrap)\//.test(line)) {
        record(filePath, index, line);
      }
    }
  }
} catch {
  // HiroApp is optional until the app tree is present.
}

if (violations.length > 0) {
  console.error(
    "Module import gate failed. Use @getstrata/core or @getstrata/bootstrap instead:\n",
  );
  console.error(violations.join("\n"));
  process.exit(1);
}

console.log("Module import gate passed.");
