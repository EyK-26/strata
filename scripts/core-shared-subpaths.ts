/**
 * Subpaths that re-export the main @getstrata/core bundle (dist/index.js).
 *
 * Use shared shims for canonical execution carriers (AsyncLocalStorage) or when
 * consumers rely on `instanceof` across import paths (Notification base class).
 * Application resources remain explicitly owned; shims do not establish a default owner.
 *
 * Synced by: scripts/sync-package-subpaths.ts, scripts/write-core-shared-shims.ts
 * Verified by: scripts/verify-core-shared-subpaths.ts
 */
/** Canonical standalone artifacts: externalize these edges even from the root bundle. */
export const CORE_STANDALONE_SUBPATHS = [
  "auth/authOutcome",
  "auth/policy",
  "contracts/authUserDirectory",
  "contracts/token",
  "contracts/container",
  "contracts/serviceTokens",
  "contracts/services",
  "contracts/executionContext",
  "contracts/executionOperations",
  "contracts/executionOwnership",
  "database/acquisitionMetrics",
  "database/errors",
  "errors/http",
  "database/definitions",
  "database/factory",
  "queue/failedJobRepository",
  "queue/queueConfig",
  "queue/queueHandoff",
  "database/tokens",
  "cache/tokens",
  "config/applicationConfig",
  "view/tokens",
] as const;

export const CORE_SHARED_SUBPATHS = [
  "auth/authContext",
  "auth/guard",
  "auth/membershipContext",
  "crypto/fieldEncryptionRotation",
  "database",
  "database/dialect",
  "database/mysqlConnection",
  "database/baseRepository",
  "database/model",
  "database/repositoryQuery",
  "database/bunSql",
  "database/connection",
  "database/connectionContext",
  "events",
  "events/outbox",
  "http",
  "http/contentSecurityPolicy",
  "http/loginThrottleMiddleware",
  "http/middleware",
  "http/requestMetaContext",
  "http/webErrorResponse",
  "lifecycle/gracefulShutdown",
  "metrics/prometheus",
  "notifications",
  "queue/jobRegistry",
  "runtime/appKeyPrefix",
  "scheduler/schedule",
  "security/safeUrl",
  "security/securityEvents",
  "tenant/tenantContext",
  "tenant/tenantMiddleware",
  "tracing/traceContext",
  "view",
] as const;

export type CoreSharedSubpath = (typeof CORE_SHARED_SUBPATHS)[number];

/** Existing declaration defaults must alias the canonical bundle value, never a second class. */
export const CORE_SHARED_DEFAULT_EXPORTS: Readonly<Record<string, string>> = {
  "database/baseRepository": "BaseRepository",
};

/** Advanced legacy subpaths retain named test hooks; the root excludes them. */
export const CORE_SHARED_TEST_HOOKS: Readonly<Record<string, readonly string[]>> = {
  "database/mysqlConnection": ["resetMysqlLoaderForTests"],
  "http/loginThrottleMiddleware": ["resetMemoryLoginThrottleForTests"],
  "security/safeUrl": ["resetDnsLookupForTests", "setDnsLookupForTests"],
};

export function renderCoreSharedShim(subpath: string): string {
  const importPath = `${"../".repeat(subpath.split("/").length)}index.js`;
  const name = CORE_SHARED_DEFAULT_EXPORTS[subpath];
  const hooks = CORE_SHARED_TEST_HOOKS[subpath];
  const testing = `${"../".repeat(subpath.split("/").length - 1)}testing.js`;
  const testExports = hooks ? `export { ${hooks.join(", ")} } from "${testing}";\n` : "";
  return `export * from "${importPath}";\n${name ? `export { ${name} as default } from "${importPath}";\n` : ""}${testExports}`;
}

export const CORE_SHARED_SUBPATH_SET = new Set<string>(CORE_SHARED_SUBPATHS);

/** CLI flags for bun build so bundled subpaths resolve package imports through npm exports. */
export function coreSubpathExternalFlags(subpaths: readonly string[]): string {
  const flags = ["--external @getstrata/core"];
  for (const subpath of subpaths) {
    flags.push(`--external @getstrata/core/${subpath}`);
  }
  return flags.join(" ");
}

export function bootstrapSubpathExternalFlags(
  bootstrapSubpaths: readonly string[],
  coreSubpaths: readonly string[],
): string {
  const flags = ["--external @getstrata/core", "--external @getstrata/bootstrap"];
  for (const subpath of bootstrapSubpaths) {
    flags.push(`--external @getstrata/bootstrap/${subpath}`);
  }
  for (const subpath of coreSubpaths) {
    flags.push(`--external @getstrata/core/${subpath}`);
  }
  return flags.join(" ");
}
