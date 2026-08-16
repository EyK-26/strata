#!/usr/bin/env bun
/** Write thin dist/entries/*.js shims that re-export the main @getstrata/core bundle. */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const CORE_SHARED_FROM_INDEX = [
  "auth/accessControl",
  "auth/authContext",
  "auth/guard",
  "auth/membershipContext",
  "auth/membershipScope",
  "auth/membershipService",
  "auth/policy",
  "database",
  "http",
  "http/middleware",
  "http/requestMetaContext",
  "security/securityEvents",
  "tenant/tenantContext",
  "tenant/tenantMiddleware",
  "runtime/applicationRegistry",
  "tracing/traceContext",
] as const;

const packageDir = join(import.meta.dir, "../packages/strata-core");

function sharedShimImportPath(subpath: string): string {
  const depth = subpath.split("/").length;
  return `${"../".repeat(depth)}index.js`;
}

for (const subpath of CORE_SHARED_FROM_INDEX) {
  const outputPath = join(packageDir, "dist/entries", `${subpath}.js`);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `export * from "${sharedShimImportPath(subpath)}";\n`, "utf8");
}

console.log(`Wrote ${CORE_SHARED_FROM_INDEX.length} shared @getstrata/core subpath shims.`);
