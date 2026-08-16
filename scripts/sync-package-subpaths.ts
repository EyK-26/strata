#!/usr/bin/env bun
/**
 * Generates subpath entry files and package.json exports for @getstrata/core and @getstrata/bootstrap.
 * Run: bun scripts/sync-package-subpaths.ts
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

const ROOT = join(import.meta.dir, "..");

const CORE_SUBPATHS = [
  "auth/accessControl",
  "auth/authContext",
  "auth/guard",
  "auth/membershipContext",
  "auth/membershipScope",
  "auth/membershipService",
  "auth/oauth/oidcProvider",
  "auth/oauth/providers",
  "auth/oauth/samlProvider",
  "auth/oauth/types",
  "auth/password",
  "auth/policy",
  "auth/sessionCookie",
  "auth/tokenHash",
  "cache/tags",
  "cache/createCacheStore",
  "contracts/serviceTokens",
  "contracts/container",
  "contracts/di",
  "crypto/fieldEncryption",
  "crypto/mfaSecret",
  "database",
  "database/factory",
  "database/seeders",
  "database/types",
  "errors/http",
  "http",
  "http/contentNegotiation",
  "http/csrfToken",
  "http/etag",
  "http/flashSession",
  "http/middleware",
  "http/parseFormBody",
  "http/resources",
  "http/requestMetaContext",
  "http/webErrorResponse",
  "http/webFormRequest",
  "jobs/dispatchWebhookJob",
  "lifecycle/gracefulShutdown",
  "metrics/prometheus",
  "pagination",
  "queue/createAppQueue",
  "queue/failedJobService",
  "queue/jobRegistry",
  "queue/jobRunner",
  "queue/queueMetrics",
  "queue/publicQueue",
  "queue/types",
  "runtime/applicationRegistry",
  "security/oauthState",
  "security/publicReads",
  "security/safeUrl",
  "security/securityEvents",
  "security/stripeWebhook",
  "security/tokenExpiry",
  "security/totp",
  "storage/storage",
  "tenant/tenantContext",
  "tenant/tenantMiddleware",
  "tracing/traceContext",
  "validation/rules",
  "view",
] as const;

/** Subpaths that must re-export the main bundle so AsyncLocalStorage singletons stay shared. */
const CORE_SHARED_FROM_INDEX = new Set<string>([
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
  "queue/jobRegistry",
  "tracing/traceContext",
]);

const BOOTSTRAP_SUBPATHS = [
  "applicationRegistry",
  "buildModuleRoutes",
  "cache/modelCacheTags",
  "config",
  "context",
  "contracts",
  "createWebRoutes",
  "dependencies",
  "discoverModules",
  "http/securedRouteModelBinding",
  "httpKernel",
  "membershipService",
  "queue/defaultJobs",
  "providers",
  "providers/view",
  "routeRegistry",
  "secretsGuard",
  "web/forms",
  "web/routing",
  "web/server",
  "web/session",
  "web/slug",
] as const;

function resolveCoreTypesPath(subpath: string): string {
  const indexModules = new Set(["database", "http", "view", "pagination"]);

  if (indexModules.has(subpath)) {
    return `./dist/core/${subpath}/index.d.ts`;
  }

  if (subpath === "database/seeders") {
    return "./dist/core/database/seeders/runner.d.ts";
  }

  return `./dist/core/${subpath}.d.ts`;
}

function resolveBootstrapTypesPath(subpath: string): string {
  if (subpath === "providers") {
    return "./dist/bootstrap/providers/index.d.ts";
  }

  if (subpath === "providers/view") {
    return "./dist/bootstrap/providers/view/index.d.ts";
  }

  return `./dist/bootstrap/${subpath}.d.ts`;
}

function buildExports(
  packageName: "core" | "bootstrap",
  subpaths: readonly string[],
): Record<string, { types: string; import: string; default: string }> {
  const srcPrefix = packageName === "core" ? "core" : "bootstrap";
  const exports: Record<string, { types: string; import: string; default: string }> = {
    ".": {
      types: `./dist/${srcPrefix === "core" ? "framework/public-api" : "bootstrap/public-api"}.d.ts`,
      import: "./dist/index.js",
      default: "./dist/index.js",
    },
  };

  for (const subpath of subpaths) {
    exports[`./${subpath}`] = {
      types:
        packageName === "core" ? resolveCoreTypesPath(subpath) : resolveBootstrapTypesPath(subpath),
      import: `./dist/entries/${subpath}.js`,
      default: `./dist/entries/${subpath}.js`,
    };
  }

  return exports;
}

async function writeEntryFiles(
  packageDir: string,
  srcLayer: "core" | "bootstrap",
  subpaths: readonly string[],
): Promise<string[]> {
  const entriesDir = join(packageDir, "entries");
  await mkdir(entriesDir, { recursive: true });
  const entryFiles: string[] = [];

  for (const subpath of subpaths) {
    if (srcLayer === "core" && CORE_SHARED_FROM_INDEX.has(subpath)) {
      continue;
    }

    const entryPath = join(entriesDir, `${subpath}.ts`);
    await mkdir(dirname(entryPath), { recursive: true });

    const indexModules = new Set(["database", "http", "view", "providers", "pagination"]);

    const sourcePath = indexModules.has(subpath)
      ? `${subpath}/index`
      : subpath === "database/seeders"
        ? "database/seeders/runner"
        : subpath;

    const srcPrefix = srcLayer === "core" ? "core" : "bootstrap";
    const sourceFile = join(ROOT, "src", srcPrefix, `${sourcePath}.ts`);
    let importPath = relative(dirname(entryPath), sourceFile).replace(/\\/g, "/");

    if (!importPath.startsWith(".")) {
      importPath = `./${importPath}`;
    }

    await writeFile(entryPath, `export * from "${importPath}";\n`, "utf8");
    entryFiles.push(entryPath);
  }

  return entryFiles;
}

async function updatePackageJson(
  packageDir: string,
  exports: Record<string, { types: string; import: string; default: string }>,
  buildEntries: string[],
): Promise<void> {
  const packageJsonPath = join(packageDir, "package.json");
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as {
    exports: Record<string, unknown>;
    scripts: Record<string, string>;
  };

  packageJson.exports = exports;

  const relativeEntries = buildEntries.map((entry) => relative(packageDir, entry)).join(" ");
  packageJson.scripts["build:bundle"] =
    `bun build index.ts --outdir dist --target bun --external bun --external eta${packageDir.includes("bootstrap") ? " --external @getstrata/core" : ""}`;
  packageJson.scripts["build:shims"] = packageDir.includes("strata-core")
    ? "bun ../../scripts/write-core-shared-shims.ts"
    : "true";
  packageJson.scripts["build:subpaths"] = relativeEntries
    ? `bun build ${relativeEntries} --outdir dist --root . --target bun --external bun --external eta${packageDir.includes("bootstrap") ? " --external @getstrata/core" : ""}`
    : "true";
  packageJson.scripts["build:types"] = packageDir.includes("bootstrap")
    ? "tsc -p tsconfig.types.json && bun ../../scripts/prune-bootstrap-dist-types.ts"
    : "tsc -p tsconfig.types.json";
  packageJson.scripts["build"] =
    "bun run build:bundle && bun run build:shims && bun run build:subpaths && bun run build:types";

  await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");
}

async function main(): Promise<void> {
  const corePackageDir = join(ROOT, "packages/strata-core");
  const bootstrapPackageDir = join(ROOT, "packages/strata-bootstrap");

  const coreEntries = await writeEntryFiles(corePackageDir, "core", CORE_SUBPATHS);
  const bootstrapEntries = await writeEntryFiles(
    bootstrapPackageDir,
    "bootstrap",
    BOOTSTRAP_SUBPATHS,
  );

  await updatePackageJson(corePackageDir, buildExports("core", CORE_SUBPATHS), coreEntries);
  await updatePackageJson(
    bootstrapPackageDir,
    buildExports("bootstrap", BOOTSTRAP_SUBPATHS),
    bootstrapEntries,
  );

  console.log(
    `Synced ${CORE_SUBPATHS.length} @getstrata/core subpaths and ${BOOTSTRAP_SUBPATHS.length} bootstrap subpaths.`,
  );
}

await main();
