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

function collectExportEntries(
  exportsField: unknown,
  prefix = "",
): Array<{ key: string; types?: string; js?: string }> {
  if (!exportsField || typeof exportsField !== "object") {
    return [];
  }

  const found: Array<{ key: string; types?: string; js?: string }> = [];
  const record = exportsField as Record<string, unknown>;

  if (typeof record.types === "string" || typeof record.import === "string") {
    found.push({
      key: prefix || ".",
      types: typeof record.types === "string" ? record.types : undefined,
      js:
        typeof record.import === "string"
          ? record.import
          : typeof record.default === "string"
            ? record.default
            : undefined,
    });
  }

  for (const [key, value] of Object.entries(record)) {
    if (key === "types" || key === "import" || key === "default" || key === "require") {
      continue;
    }

    found.push(...collectExportEntries(value, prefix ? `${prefix} ${key}` : key));
  }

  return found;
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

/** Value (runtime) names declared by a .d.ts file. Type-only exports are ignored. */
function parseDeclaredValueExports(source: string): Set<string> {
  const names = new Set<string>();
  const text = stripComments(source);

  for (const match of text.matchAll(
    /export\s+(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:function|class|const|let|var|enum)\s+([A-Za-z_$][\w$]*)/g,
  )) {
    const declaredName = match[1];
    if (declaredName) {
      names.add(declaredName);
    }
  }

  for (const match of text.matchAll(/export\s*\{([^}]+)\}/g)) {
    const exportedList = match[1];
    if (!exportedList) {
      continue;
    }

    for (const part of exportedList.split(",")) {
      const trimmed = part.trim();
      if (!trimmed || trimmed.startsWith("type ")) {
        continue;
      }

      const aliasMatch = trimmed.match(/^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/);
      if (!aliasMatch) {
        continue;
      }

      const exportedName = aliasMatch[2] ?? aliasMatch[1];
      if (exportedName) {
        names.add(exportedName);
      }
    }
  }

  return names;
}

const missing: string[] = [];
const unreachable: string[] = [];
let facadesTypesPath: string | null = null;
let runtimeChecked = 0;

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

  const exportEntries = collectExportEntries(packageJson.exports);

  for (const { key, types, js } of exportEntries) {
    if (types) {
      const absolute = join(packageDir, types);
      if (!existsSync(absolute)) {
        missing.push(`${packageJson.name} ${key} -> ${types}`);
      }

      if (packageJson.name === "@getstrata/core" && key === "./facades") {
        facadesTypesPath = absolute;
      }
    }

    if (!types || !js) {
      continue;
    }

    const dtsPath = join(packageDir, types);
    const jsPath = join(packageDir, js);
    if (!existsSync(dtsPath) || !existsSync(jsPath)) {
      continue;
    }

    const declared = parseDeclaredValueExports(await readFile(dtsPath, "utf8"));
    if (declared.size === 0) {
      continue;
    }

    let moduleExports: Record<string, unknown>;
    try {
      moduleExports = (await import(jsPath)) as Record<string, unknown>;
    } catch (error) {
      unreachable.push(
        `${packageJson.name} ${key} failed to import ${js}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      continue;
    }

    runtimeChecked += 1;
    for (const name of [...declared].sort()) {
      if (!(name in moduleExports) || moduleExports[name] === undefined) {
        unreachable.push(`${packageJson.name} ${key} UNREACHABLE ${name}`);
      }
    }
  }
}

if (missing.length > 0) {
  console.error(`Missing export types files:\n${missing.map((line) => `- ${line}`).join("\n")}`);
  process.exit(1);
}

if (unreachable.length > 0) {
  console.error(
    `Export types declare runtime names that the JS entry does not export:\n${unreachable
      .map((line) => `- ${line}`)
      .join("\n")}`,
  );
  process.exit(1);
}

console.log(`Export types paths OK (${runtimeChecked} entries compared to runtime).`);

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
