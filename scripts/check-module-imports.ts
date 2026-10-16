#!/usr/bin/env bun
/**
 * CI gate: fail if application code reaches framework sources via relative paths
 * instead of `@getstrata/core` / `@getstrata/bootstrap` subpaths.
 * Scan actual emitted source from every legacy profile; empty/missing input fails.
 */

import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { createGeneratedSourceApps } from "../tests/helpers/generatedSourceApps.ts";

const fixtures = createGeneratedSourceApps();
let scanned = 0;
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
  for (const app of [fixtures.rls, fixtures.hobby, fixtures.team]) {
    const files = await walk(join(app, "src"));
    if (files.length === 0) throw new Error("Generated import gate found no application source.");
    for (const filePath of files) {
      scanned++;
      const lines = (await readFile(filePath, "utf8")).split("\n");
      for (let index = 0; index < lines.length; index++) {
        const line = lines[index] ?? "";
        if (
          /from\s+['"](?:\.\.\/)+src\/(?:core|bootstrap)\//.test(line) ||
          /from\s+['"]@getstrata\/core['"]/.test(line) ||
          /from\s+['"]@getstrata\/core\/(?:database|http)['"]/.test(line)
        ) {
          record(filePath, index, line);
        }
      }
    }
  }
} finally {
  fixtures.close();
}

if (violations.length > 0) {
  console.error(
    "Module import gate failed. Use @getstrata/core or @getstrata/bootstrap instead:\n",
  );
  console.error(violations.join("\n"));
  process.exit(1);
}

console.log(`Module import gate passed (${scanned} generated source files across three profiles).`);
