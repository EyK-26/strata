#!/usr/bin/env bun
/** Verify published package versions match the release matrix. */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");

const EXPECTED: Record<string, string> = {
  "@getstrata/core": "1.0.5",
  "@getstrata/bootstrap": "1.0.5",
  "@getstrata/cli": "1.0.5",
  "@getstrata/starter": "1.0.5",
  "create-strata": "1.0.5",
};

const PACKAGE_DIRS: Record<string, string> = {
  "@getstrata/core": "packages/strata-core/package.json",
  "@getstrata/bootstrap": "packages/strata-bootstrap/package.json",
  "@getstrata/cli": "packages/strata-cli/package.json",
  "@getstrata/starter": "packages/strata-starter/package.json",
  "create-strata": "packages/create-strata/package.json",
};

const mismatches: string[] = [];

for (const [name, relativePath] of Object.entries(PACKAGE_DIRS)) {
  const packageJson = JSON.parse(await readFile(join(ROOT, relativePath), "utf8")) as {
    name: string;
    version: string;
  };
  const expected = EXPECTED[name];

  if (packageJson.version !== expected) {
    mismatches.push(`${name}: expected ${expected}, got ${packageJson.version}`);
  }
}

if (mismatches.length > 0) {
  console.error(`Package version mismatch:\n${mismatches.join("\n")}`);
  process.exit(1);
}

console.log(
  "Package versions OK:",
  Object.entries(EXPECTED)
    .map(([k, v]) => `${k}@${v}`)
    .join(", "),
);
