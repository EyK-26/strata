#!/usr/bin/env bun
/** eta and mysql2 are optional peers, loaded only through dynamic import(). */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const errors: string[] = [];

const packageJson = JSON.parse(
  await readFile(join(ROOT, "packages/strata-core/package.json"), "utf8"),
) as {
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
};

for (const name of ["eta", "mysql2"] as const) {
  if (packageJson.dependencies?.[name]) {
    errors.push(`@getstrata/core must not list ${name} in dependencies`);
  }
  if (!packageJson.peerDependencies?.[name]) {
    errors.push(`@getstrata/core is missing optional peer ${name}`);
  }
  if (!packageJson.peerDependenciesMeta?.[name]?.optional) {
    errors.push(`@getstrata/core peer ${name} must be optional`);
  }
}

const indexJs = await readFile(join(ROOT, "packages/strata-core/dist/index.js"), "utf8");
if (/from\s+["']mysql2/.test(indexJs)) {
  errors.push("dist/index.js has a static mysql2 import; keep MySQL on database/mysqlConnection");
}
if (/from\s+["']eta["']/.test(indexJs)) {
  errors.push("dist/index.js has a static eta import; EtaViewEngine must lazy-import eta");
}

const mysqlEntry = await readFile(
  join(ROOT, "packages/strata-core/dist/entries/database/mysqlConnection.js"),
  "utf8",
);
const mysqlIsSharedShim = /export \* from ["'][./]*index\.js["']/.test(mysqlEntry);
if (mysqlIsSharedShim) {
  if (!indexJs.includes('import("mysql2/promise")')) {
    errors.push(
      "shared mysqlConnection shim re-exports the barrel, which must lazy-import mysql2/promise",
    );
  }
} else {
  if (!mysqlEntry.includes('import("mysql2/promise")')) {
    errors.push("database/mysqlConnection must lazy-import mysql2/promise");
  }
  if (/from\s+["']mysql2/.test(mysqlEntry)) {
    errors.push("database/mysqlConnection has a static mysql2 import");
  }
}

const mysqlTypes = await readFile(
  join(ROOT, "packages/strata-core/dist/core/database/mysqlConnection.d.ts"),
  "utf8",
);
if (/from\s+["']mysql2/.test(mysqlTypes)) {
  errors.push("database/mysqlConnection.d.ts must not import mysql2 (keep it an optional peer)");
}

const viewEntry = await readFile(join(ROOT, "packages/strata-core/dist/entries/view.js"), "utf8");
const viewIsSharedShim = /export \* from ["'][./]*index\.js["']/.test(viewEntry);
if (viewIsSharedShim) {
  if (!indexJs.includes('import("eta")')) {
    errors.push("shared view shim re-exports the barrel, which must lazy-import eta");
  }
} else {
  if (!viewEntry.includes('import("eta")')) {
    errors.push("view entry must lazy-import eta");
  }
  if (/from\s+["']eta["']/.test(viewEntry)) {
    errors.push("view entry has a static eta import");
  }
}

if (errors.length > 0) {
  console.error(`Optional peer verification failed:\n${errors.map((e) => `- ${e}`).join("\n")}`);
  process.exit(1);
}

console.log("Optional peers OK: eta and mysql2 are optional, loaded through import().");
