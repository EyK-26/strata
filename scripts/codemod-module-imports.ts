#!/usr/bin/env bun
/**
 * Codemod src/modules imports from ../../core|bootstrap to @getstrata/* package subpaths.
 * Run: bun scripts/codemod-module-imports.ts
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const MODULES_DIR = join(import.meta.dir, "../src/modules");

async function transformFile(filePath: string): Promise<boolean> {
  const original = await readFile(filePath, "utf8");
  const updated = original
    .replace(/from "\.\.\/\.\.\/core\//g, 'from "@getstrata/core/')
    .replace(/from "\.\.\/\.\.\/bootstrap\//g, 'from "@getstrata/bootstrap/');

  if (updated === original) {
    return false;
  }

  await writeFile(filePath, updated, "utf8");
  return true;
}

async function walk(dir: string): Promise<number> {
  let changed = 0;

  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      changed += await walk(fullPath);
      continue;
    }

    if (!entry.name.endsWith(".ts")) {
      continue;
    }

    if (await transformFile(fullPath)) {
      changed += 1;
    }
  }

  return changed;
}

try {
  const changed = await walk(MODULES_DIR);
  console.log(`Updated imports in ${changed} module file(s).`);
} catch (error) {
  if ((error as NodeJS.ErrnoException).code === "ENOENT") {
    console.log("No src/modules directory; nothing to codemod.");
  } else {
    throw error;
  }
}
