/**
 * Subpaths that re-export the main @getstrata/core bundle (dist/index.js).
 *
 * Use shared shims when a module owns process-wide singleton state (AsyncLocalStorage,
 * default DB pool, global registries) or when consumers rely on `instanceof` across
 * import paths (Notification base class).
 *
 * Synced by: scripts/sync-package-subpaths.ts, scripts/write-core-shared-shims.ts
 * Verified by: scripts/verify-core-shared-subpaths.ts
 */
/** Canonical standalone artifacts: externalize these edges even from the root bundle. */
export const CORE_STANDALONE_SUBPATHS = [
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
  "runtime/applicationRegistry",
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

export function renderCoreSharedShim(subpath: string): string {
  const importPath = `${"../".repeat(subpath.split("/").length)}index.js`;
  const name = CORE_SHARED_DEFAULT_EXPORTS[subpath];
  return `export * from "${importPath}";\n${name ? `export { ${name} as default } from "${importPath}";\n` : ""}`;
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

/** @deprecated Use coreSubpathExternalFlags(CORE_SUBPATHS) from sync-package-subpaths. */
export function coreSharedSubpathExternalFlags(): string {
  return coreSubpathExternalFlags(CORE_SHARED_SUBPATHS);
}
