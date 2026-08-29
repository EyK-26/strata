#!/usr/bin/env bun
/** Verify published @getstrata package versions match the Phase 6 release matrix. */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");

const EXPECTED: Record<string, string> = {
  "@getstrata/core": "0.5.65",
  "@getstrata/bootstrap": "0.2.53",
  "@getstrata/cli": "0.2.0",
  "@getstrata/starter": "0.1.4",
};

const PACKAGE_DIRS: Record<string, string> = {
  "@getstrata/core": "packages/strata-core/package.json",
  "@getstrata/bootstrap": "packages/strata-bootstrap/package.json",
  "@getstrata/cli": "packages/strata-cli/package.json",
  "@getstrata/starter": "packages/strata-starter/package.json",
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
