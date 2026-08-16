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
  "auth/abilityChecker",
  "auth/authContext",
  "auth/guard",
  "auth/membershipContext",
  "auth/membershipMiddleware",
  "auth/membershipScope",
  "auth/membershipService",
  "auth/oauth/oidcProvider",
  "auth/oauth/providers",
  "auth/oauth/samlProvider",
  "auth/oauth/types",
  "auth/password",
  "auth/policy",
  "auth/scimAuthMiddleware",
  "auth/sessionCookie",
  "auth/sessionGuard",
  "auth/tokenHash",
  "audit/exportAuditLogs",
  "audit/siemFormatter",
  "admin/formatValue",
  "admin/registry",
  "admin/types",
  "cache/tags",
  "cache/createCacheStore",
  "cache/repository",
  "cache/simpleCache",
  "cache/simpleCacheStore",
  "config/envSchema",
  "contracts/serviceTokens",
  "contracts/container",
  "contracts/di",
  "crypto/fieldEncryption",
  "crypto/mfaSecret",
  "database",
  "database/baseRepository",
  "database/bindConnection",
  "database/boundConnection",
  "database/connection",
  "database/defaultConnection",
  "database/errors",
  "database/factory",
  "database/migrations",
  "database/migrations/types",
  "database/model",
  "database/query",
  "database/relationships",
  "database/repositoryConnection",
  "database/seeders",
  "database/seeders/types",
  "database/schema",
  "database/table",
  "database/transaction",
  "database/types",
  "errors/http",
  "events",
  "http",
  "http/authMiddleware",
  "http/authorizeMiddleware",
  "http/bodySizeLimitMiddleware",
  "http/cookies",
  "http/contentNegotiation",
  "http/conditionalResponse",
  "http/corsMiddleware",
  "http/csrfMiddleware",
  "http/csrfProtection",
  "http/csrfToken",
  "http/etag",
  "http/flashSession",
  "http/flashMiddleware",
  "http/formRequest",
  "http/middleware",
  "http/metricsMiddleware",
  "http/loginThrottleMiddleware",
  "http/memoryThrottleMiddleware",
  "http/pagination",
  "http/parseFormBody",
  "http/parseMultipartUpload",
  "http/requireAbilityMiddleware",
  "http/requireAuthMiddleware",
  "http/requireGlobalAdminMiddleware",
  "http/requireWebAuthMiddleware",
  "http/resources",
  "http/route",
  "http/routeMiddleware",
  "http/routeModelBinding",
  "http/scimThrottleMiddleware",
  "http/securityHeadersMiddleware",
  "http/securedRouteModelBinding",
  "http/requestMetaContext",
  "http/webErrorResponse",
  "http/webFormRequest",
  "http/throttleMiddleware",
  "jobs/dispatchWebhookJob",
  "jobs/invalidateCacheTagsJob",
  "lifecycle/gracefulShutdown",
  "logging/logger",
  "logging/requestLoggingMiddleware",
  "mail/mailer",
  "mail/markdownMail",
  "mail/markdownMailable",
  "metrics/prometheus",
  "notifications",
  "openapi/generator",
  "openapi/registeredRoute",
  "openapi/validate",
  "pagination",
  "queue",
  "queue/createAppQueue",
  "queue/failedJobRepository",
  "queue/failedJobService",
  "queue/jobRegistry",
  "queue/jobRunner",
  "queue/queueMetrics",
  "queue/publicQueue",
  "queue/redisQueue",
  "queue/types",
  "runtime/applicationRegistry",
  "runtime/asyncContextStore",
  "scheduler/schedule",
  "security/oauthState",
  "security/publicReads",
  "security/safeFetch",
  "security/safeUrl",
  "security/scimTenantTokens",
  "security/securityEvents",
  "security/stripeWebhook",
  "security/timingSafeCompare",
  "security/tokenExpiry",
  "security/totp",
  "storage/storage",
  "tenant/tenantContext",
  "tenant/tenantDatabaseScope",
  "tenant/databaseTenantContext",
  "tenant/tenantMiddleware",
  "tracing/traceContext",
  "tracing/tracingMiddleware",
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
  "database/bindConnection",
  "database/boundConnection",
  "database/connection",
  "database/defaultConnection",
  "database/repositoryConnection",
  "events",
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
  "buildWebModuleRoutes",
  "cache/modelCacheTags",
  "config",
  "context",
  "contracts",
  "createWebRoutes",
  "createRoutes",
  "createSpaRoutes",
  "dependencies",
  "discoverModules",
  "health",
  "http/securedRouteModelBinding",
  "httpKernel",
  "listeners/invalidateCacheOnModelWrite",
  "membershipService",
  "metricsRoutes",
  "queue/defaultJobs",
  "providers",
  "providers/view",
  "routeRegistry",
  "schedule",
  "secretsGuard",
  "web/forms",
  "web/routing",
  "web/server",
  "web/session",
  "web/slug",
] as const;

function resolveCoreTypesPath(subpath: string): string {
  const indexModules = new Set([
    "database",
    "database/schema",
    "events",
    "http",
    "notifications",
    "queue",
    "view",
    "pagination",
  ]);

  if (indexModules.has(subpath)) {
    return `./dist/core/${subpath}/index.d.ts`;
  }

  if (subpath === "database/seeders") {
    return "./dist/core/database/seeders/runner.d.ts";
  }

  if (subpath === "database/migrations") {
    return "./dist/core/database/migrations/runner.d.ts";
  }

  if (subpath === "database/migrations/types") {
    return "./dist/core/database/migrations/types.d.ts";
  }

  if (subpath === "database/seeders/types") {
    return "./dist/core/database/seeders/types.d.ts";
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

    const indexModules = new Set([
      "database",
      "database/schema",
      "events",
      "http",
      "notifications",
      "queue",
      "view",
      "providers",
      "pagination",
    ]);

    const sourcePath = indexModules.has(subpath)
      ? `${subpath}/index`
      : subpath === "database/seeders"
        ? "database/seeders/runner"
        : subpath === "database/migrations"
          ? "database/migrations/runner"
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
