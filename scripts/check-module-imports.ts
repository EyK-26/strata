#!/usr/bin/env bun
/**
 * CI gate: fail if src/modules contains deep ../../core or ../../bootstrap imports.
 */

import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

const MODULE_ROOTS = [
  join(import.meta.dir, "../src/modules"),
  join(import.meta.dir, "../apps/hiroapp/src"),
];
const violations: string[] = [];

async function walk(dir: string): Promise<void> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      await walk(fullPath);
      continue;
    }

    if (!entry.name.endsWith(".ts")) {
      continue;
    }

    const content = await readFile(fullPath, "utf8");
    const lines = content.split("\n");

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? "";

      if (
        line.includes('from "../../core/') ||
        line.includes('from "../../bootstrap/') ||
        line.includes("from '../../core/") ||
        line.includes("from '../../bootstrap/")
      ) {
        violations.push(
          `${relative(join(import.meta.dir, ".."), fullPath)}:${index + 1}: ${line.trim()}`,
        );
      }
    }
  }
}

for (const root of MODULE_ROOTS) {
  await walk(root);
}

if (violations.length > 0) {
  console.error(
    "Module import gate failed. Use @getstrata/core or @getstrata/bootstrap instead:\n",
  );
  console.error(violations.join("\n"));
  process.exit(1);
}

console.log("Module import gate passed.");
