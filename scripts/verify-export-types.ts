#!/usr/bin/env bun

/** Fail if package.json export "types" paths are missing after a package build. */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");

const PACKAGES = [
  "packages/strata-core/package.json",
  "packages/strata-bootstrap/package.json",
  "packages/strata-cli/package.json",
];

type ExportEntry = {
  types?: string;
  import?: string;
  default?: string;
  [key: string]: unknown;
};

function collectTypesPaths(
  exportsField: unknown,
  prefix = "",
): Array<{ key: string; types: string }> {
  if (!exportsField || typeof exportsField !== "object") {
    return [];
  }

  const found: Array<{ key: string; types: string }> = [];
  const record = exportsField as Record<string, unknown>;

  if (typeof record.types === "string") {
    found.push({ key: prefix || ".", types: record.types });
  }

  for (const [key, value] of Object.entries(record)) {
    if (key === "types" || key === "import" || key === "default" || key === "require") {
      continue;
    }

    found.push(...collectTypesPaths(value, prefix ? `${prefix} ${key}` : key));
  }

  return found;
}

const missing: string[] = [];
let facadesTypesPath: string | null = null;

for (const relativePath of PACKAGES) {
  const packageJsonPath = join(ROOT, relativePath);
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as {
    name: string;
    exports?: ExportEntry | Record<string, ExportEntry>;
  };
  const packageDir = join(ROOT, relativePath, "..");

  if (!existsSync(join(packageDir, "dist"))) {
    console.log(`Skipping ${packageJson.name}: dist/ not built.`);
    continue;
  }

  const typesPaths = collectTypesPaths(packageJson.exports);

  for (const { key, types } of typesPaths) {
    const absolute = join(packageDir, types);
    if (!existsSync(absolute)) {
      missing.push(`${packageJson.name} ${key} -> ${types}`);
    }

    if (packageJson.name === "@getstrata/core" && key === "./facades") {
      facadesTypesPath = absolute;
    }
  }
}

if (missing.length > 0) {
  console.error(`Missing export types files:\n${missing.map((line) => `- ${line}`).join("\n")}`);
  process.exit(1);
}

console.log("Export types paths OK.");

if (facadesTypesPath) {
  const fixtureDir = join(ROOT, "scripts/fixtures/facades-types");
  const result = spawnSync("bunx", ["tsc", "--noEmit", "-p", fixtureDir], {
    cwd: ROOT,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    console.error(result.stdout);
    console.error(result.stderr);
    console.error(`@getstrata/core/facades failed tsc --noEmit (types: ${facadesTypesPath})`);
    process.exit(1);
  }

  console.log("@getstrata/core/facades typechecks OK.");
}
