#!/usr/bin/env bun
/** Verify published package versions match the release matrix. */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { checkPackagePeerCompatibility, type PackageVersion } from "./release-readiness";

const ROOT = join(import.meta.dir, "..");

const EXPECTED: Record<string, string> = {
  "@getstrata/core": "2.2.8",
  "@getstrata/bootstrap": "2.2.8",
  "@getstrata/cli": "2.2.8",
  "@getstrata/starter": "2.2.8",
  "create-strata": "2.2.8",
};

const PACKAGE_DIRS: Record<string, string> = {
  "@getstrata/core": "packages/strata-core/package.json",
  "@getstrata/bootstrap": "packages/strata-bootstrap/package.json",
  "@getstrata/cli": "packages/strata-cli/package.json",
  "@getstrata/starter": "packages/strata-starter/package.json",
  "create-strata": "packages/create-strata/package.json",
};

const mismatches: string[] = [];
const packages: PackageVersion[] = [];

for (const [name, relativePath] of Object.entries(PACKAGE_DIRS)) {
  const packageJson = JSON.parse(await readFile(join(ROOT, relativePath), "utf8")) as {
    name: string;
    version: string;
    peerDependencies?: Record<string, string>;
  };
  packages.push(packageJson);
  const expected = EXPECTED[name];

  if (packageJson.version !== expected) {
    mismatches.push(`${name}: expected ${expected}, got ${packageJson.version}`);
  }
}

mismatches.push(...checkPackagePeerCompatibility(packages));

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
