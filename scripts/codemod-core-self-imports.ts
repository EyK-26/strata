#!/usr/bin/env bun
/** Rewrites relative imports of shared singleton modules to @getstrata/core/* self-imports. */

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CORE_SHARED_SUBPATHS } from "./core-shared-subpaths.ts";

const ROOT = join(import.meta.dir, "..");
const CORE_SRC = join(ROOT, "src/core");

const ORDERED_SUBPATHS = [...CORE_SHARED_SUBPATHS].sort((a, b) => b.length - a.length);

async function walk(dir: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(path)));
    } else if (entry.name.endsWith(".ts")) {
      files.push(path);
    }
  }
  return files;
}

function rewrite(content: string): string {
  let next = content;

  for (const subpath of ORDERED_SUBPATHS) {
    const escaped = subpath.replace(/\//g, "\\/");
    const pattern = new RegExp(`from ['"](?:\\.\\./)+${escaped}(?:\\.ts)?['"]`, "g");
    next = next.replace(pattern, `from "@getstrata/core/${subpath}"`);
  }

  return next;
}

let changed = 0;

for (const file of await walk(CORE_SRC)) {
  const before = await readFile(file, "utf8");
  const after = rewrite(before);
  if (after !== before) {
    await writeFile(file, after, "utf8");
    changed += 1;
  }
}

console.log(`Codemodded ${changed} src/core files to @getstrata/core self-imports.`);
