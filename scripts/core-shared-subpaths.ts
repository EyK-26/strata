/**
 * Subpaths that re-export the main @getstrata/core bundle (dist/index.js).
 *
 * Use shared shims when a module owns process-wide singleton state (AsyncLocalStorage,
 * default DB pool, global registries) or when consumers rely on `instanceof` across
 * import paths (HttpError subclasses, Notification base class).
 *
 * Synced by: scripts/sync-package-subpaths.ts, scripts/write-core-shared-shims.ts
 * Verified by: scripts/verify-core-shared-subpaths.ts
 */
export const CORE_SHARED_SUBPATHS = [
  "auth/accessControl",
  "auth/authContext",
  "auth/guard",
  "auth/membershipContext",
  "auth/membershipScope",
  "auth/membershipService",
  "auth/policy",
  "database",
  "database/baseRepository",
  "database/bindConnection",
  "database/boundConnection",
  "database/connection",
  "database/defaultConnection",
  "database/repositoryConnection",
  "database/transaction",
  "errors/http",
  "events",
  "http",
  "http/middleware",
  "http/requestMetaContext",
  "notifications",
  "queue/jobRegistry",
  "runtime/applicationRegistry",
  "security/securityEvents",
  "tenant/tenantContext",
  "tenant/tenantMiddleware",
  "tracing/traceContext",
] as const;

export type CoreSharedSubpath = (typeof CORE_SHARED_SUBPATHS)[number];

export const CORE_SHARED_SUBPATH_SET = new Set<string>(CORE_SHARED_SUBPATHS);

/** CLI flags for bun build so bundled subpaths resolve shared modules through npm exports. */
export function coreSharedSubpathExternalFlags(): string {
  const flags = ["--external @getstrata/core"];
  for (const subpath of CORE_SHARED_SUBPATHS) {
    flags.push(`--external @getstrata/core/${subpath}`);
  }
  return flags.join(" ");
}
