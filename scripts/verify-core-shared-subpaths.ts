#!/usr/bin/env bun
/** Ensure shared subpath shims re-export the main @getstrata/core bundle. */

import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { CORE_SHARED_SUBPATHS } from "./core-shared-subpaths.ts";

const ROOT = join(import.meta.dir, "..");
const ENTRIES_DIR = join(ROOT, "packages/strata-core/dist/entries");
const CONSUMER_SCAN_ROOTS = [
  join(ROOT, "packages/strata-starter/src"),
  join(ROOT, "packages/strata-starter/templates"),
  join(ROOT, "src"),
];

const IMPORT_PATTERN =
  /import\s+(?!type\s)\{([^}]+)\}\s+from\s+["']@getstrata\/core\/([^"']+)["']/g;

const sharedSubpathSet = new Set<string>(CORE_SHARED_SUBPATHS);

/** Runtime names that must exist on the published JS entry even without a sibling checkout. */
const REQUIRED_SHARED_RUNTIME_EXPORTS: Record<string, readonly string[]> = {
  "auth/membershipContext": [
    "loadMembershipSnapshot",
    "runWithMembershipSnapshot",
    "runWithMembershipContext",
    "currentOrganizationIds",
  ],
  "metrics/prometheus": ["PrometheusRegistry", "prometheusRegistry", "HTTP_DURATION_BUCKETS_MS"],
  "queue/queueMetrics": ["createFailedJobMetricsCollector", "renderFailedJobMetrics"],
  "tracing/tracingMiddleware": ["createTracingRuntime", "renderTracingMetrics"],
  "database/model": ["Model", "ModelQuery", "defineModel", "defineRepository", "repositoryEffects"],
  "scheduler/schedule": [
    "appSchedule",
    "Schedule",
    "runDueScheduledTasks",
    "RedisSchedulerLeaseStore",
    "SchedulerLeaseLostError",
  ],
  "events/outbox": [
    "SqlOutbox",
    "createSqlOutboxBindings",
    "createOutboxWorkerTransport",
    "createOutboxMigration",
    "createOutboxMetricsCollector",
    "renderOutboxMetrics",
  ],
  "database/bunSql": ["createBunSqlPool"],
  "database/dialect": ["currentSqlDialect", "sqlTimestamp", "runWithSqlDialect"],
  "database/mysqlConnection": [
    "createMysqlConnection",
    "createMysqlConnectionFromPool",
    "createMysqlPool",
  ],
  "http/loginThrottleMiddleware": [
    "createLoginThrottleMiddleware",
    "createMemoryLoginThrottleMiddleware",
    "resolveLoginEmail",
    "resolveLoginIdentity",
  ],
  "http/webErrorResponse": ["logServerError", "normalizeFieldErrors", "webErrorResponse"],
  "security/safeUrl": [
    "pinUrlToAddress",
    "resolveSafeOutboundTarget",
    "assertSafeOutboundUrl",
    "assertSafeOutboundUrlResolved",
    "isBlockedHostname",
    "isBlockedIpAddress",
  ],
  view: ["createWebErrorView", "renderWebErrorHtml"],
};

function parseImportNames(specifier: string): string[] {
  return specifier
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !part.startsWith("type "))
    .map((part) => {
      const aliasMatch = part.match(/^(\w+)(?:\s+as\s+(\w+))?$/);
      return aliasMatch?.[1] ?? part;
    });
}

async function collectSourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") {
        continue;
      }
      files.push(...(await collectSourceFiles(fullPath)));
      continue;
    }

    if (/\.(?:ts|tsx)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

const requiredExports = new Map<string, Set<string>>();

for (const scanRoot of CONSUMER_SCAN_ROOTS) {
  let files: string[] = [];
  try {
    files = await collectSourceFiles(scanRoot);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.warn(`Skipping consumer scan root ${scanRoot}: ${detail}`);
    continue;
  }

  for (const filePath of files) {
    const source = await readFile(filePath, "utf8");

    for (const match of source.matchAll(IMPORT_PATTERN)) {
      const subpath = match[2]!;
      if (!sharedSubpathSet.has(subpath)) {
        continue;
      }

      const names = parseImportNames(match[1]!);
      const bucket = requiredExports.get(subpath) ?? new Set<string>();
      for (const name of names) {
        bucket.add(name);
      }
      requiredExports.set(subpath, bucket);
    }
  }
}

const errors: string[] = [];
const manifest = JSON.parse(
  await readFile(join(ROOT, "packages/strata-core/package.json"), "utf8"),
) as { exports: Record<string, unknown> };

for (const subpath of CORE_SHARED_SUBPATHS) {
  if (!manifest.exports[`./${subpath}`]) {
    errors.push(`Shared subpath @getstrata/core/${subpath} is missing from package exports`);
  }
  const shimPath = join(ENTRIES_DIR, `${subpath}.js`);
  let shimSource: string;

  try {
    shimSource = await readFile(shimPath, "utf8");
  } catch {
    errors.push(`Missing built shim: dist/entries/${subpath}.js (run build:framework first)`);
    continue;
  }

  const depth = subpath.split("/").length;
  const expectedImport = `${"../".repeat(depth)}index.js`;

  if (!shimSource.includes(`export * from "${expectedImport}"`)) {
    errors.push(`Shim dist/entries/${subpath}.js does not re-export ${expectedImport}`);
  }

  if (shimSource.includes("class ValidationError")) {
    errors.push(
      `Shim dist/entries/${subpath}.js bundles ValidationError instead of re-exporting index`,
    );
  }

  const required = new Set<string>([
    ...(requiredExports.get(subpath) ?? []),
    ...(REQUIRED_SHARED_RUNTIME_EXPORTS[subpath] ?? []),
  ]);
  if (required.size === 0) {
    continue;
  }

  const shimModule = await import(shimPath);
  for (const exportName of required) {
    if (!(exportName in shimModule) || shimModule[exportName] === undefined) {
      errors.push(
        `Shared subpath @getstrata/core/${subpath} missing runtime export "${exportName}"`,
      );
    }
  }
}

// Test controls are available only through the explicit testing surface.
const testing = await import(join(ENTRIES_DIR, "testing.js"));
for (const name of [
  "setNodeSamlLoaderForTests",
  "resetMysqlLoaderForTests",
  "resetMemoryThrottleForTests",
  "resetMemoryLoginThrottleForTests",
  "resetDnsLookupForTests",
  "setDnsLookupForTests",
]) {
  assert.equal(typeof testing[name], "function", `${name} must remain available to test fixtures`);
}
for (const [subpath, entry] of Object.entries(manifest.exports)) {
  if (subpath === "./testing" || !entry || typeof entry !== "object") continue;
  const target = Reflect.get(entry, "import");
  if (typeof target !== "string") continue;
  const normal = await import(join(ROOT, "packages/strata-core", target));
  for (const name of Object.keys(normal)) {
    assert(!name.endsWith("ForTests"), `Production export ${subpath} exposes test control ${name}`);
  }
}

const barrelPath = join(ROOT, "packages/strata-core/dist/index.js");
try {
  const barrel = await import(barrelPath);
  for (const removed of [
    "setNodeSamlLoaderForTests",
    "resetMysqlLoaderForTests",
    "resetMemoryThrottleForTests",
    "resetMemoryLoginThrottleForTests",
    "resetDnsLookupForTests",
    "setDnsLookupForTests",
    "configureMembershipLookup",
    "resetMembershipLookupForTests",
    "resolveMembershipLookup",
    "bootModels",
    "registerModelRepository",
    "registerModelClass",
    "snapshotModelQuery",
    "createBoundModel",
    "getBindingPorts",
    "bindDatabaseConnection",
    "getBoundDatabaseConnection",
    "resetBoundDatabaseConnection",
    "registerDefaultDatabasePool",
    "getDefaultDatabasePool",
    "getDefaultDatabaseQuery",
    "isDefaultDatabaseConnection",
    "resetDefaultDatabasePoolForTests",
    "bindBunSql",
    "getNamedConnection",
    "hasNamedConnection",
    "registerNamedConnection",
    "resetNamedConnections",
    "runOnNamedConnection",
    "unregisterNamedConnection",
    "repositoryConnection",
    "resolveRepositoryConnection",
  ]) {
    assert(
      !(removed in barrel),
      `Removed global or private helper leaked from package: ${removed}`,
    );
  }
  // Legacy barrel compatibility belongs in the package verifier; application
  // consumers keep using granular imports as required by the import gate.
  const { ModelQuery } = await import(join(ENTRIES_DIR, "database/model.js"));
  const { ModelQuery: DatabaseModelQuery } = await import(join(ENTRIES_DIR, "database.js"));
  assert.equal(ModelQuery, DatabaseModelQuery, "ModelQuery must retain legacy database identity.");
  assert.equal(ModelQuery, barrel.ModelQuery, "ModelQuery must retain root bundle identity.");
} catch (error) {
  errors.push(
    `Unable to import packages/strata-core/dist/index.js: ${error instanceof Error ? error.message : String(error)}`,
  );
}

if (errors.length > 0) {
  console.error(`Shared subpath verification failed:\n${errors.map((e) => `- ${e}`).join("\n")}`);
  process.exit(1);
}

const importCount = [...requiredExports.values()].reduce((sum, set) => sum + set.size, 0);
console.log(
  `Shared subpaths OK (${CORE_SHARED_SUBPATHS.length} shims, ${importCount} imported symbols verified).`,
);
