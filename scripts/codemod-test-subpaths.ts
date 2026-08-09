#!/usr/bin/env bun
/** Rewrites ../../src/core/* test imports to @getstrata/core/* subpaths where published. */

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const TEST_DIRS = [join(ROOT, "tests/unit"), join(ROOT, "tests/integration")];

/** Subpaths with published entries (includes shared shims). */
const SUBPATHS = new Set([
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
  "auth/scimAuthMiddleware",
  "auth/sessionCookie",
  "auth/sessionGuard",
  "auth/tokenHash",
  "audit/exportAuditLogs",
  "audit/siemFormatter",
  "admin/formatValue",
  "admin/registry",
  "cache/tags",
  "cache/createCacheStore",
  "cache/repository",
  "cache/simpleCache",
  "cache/simpleCacheStore",
  "config/envSchema",
  "contracts/container",
  "contracts/di",
  "contracts/serviceTokens",
  "crypto/fieldEncryption",
  "crypto/mfaSecret",
  "database",
  "database/baseRepository",
  "database/bindConnection",
  "database/boundConnection",
  "database/connection",
  "database/errors",
  "database/factory",
  "database/model",
  "database/query",
  "database/relationships",
  "database/seeders",
  "database/schema",
  "database/table",
  "database/transaction",
  "errors/http",
  "events",
  "http",
  "http/authMiddleware",
  "http/authorizeMiddleware",
  "http/bodySizeLimitMiddleware",
  "http/clientIp",
  "http/contentNegotiation",
  "http/cookies",
  "http/csrfProtection",
  "http/csrfToken",
  "http/etag",
  "http/flashSession",
  "http/metricsMiddleware",
  "http/middleware",
  "http/parseFormBody",
  "http/parseMultipartUpload",
  "http/resources",
  "http/securedRouteModelBinding",
  "http/requestMetaContext",
  "http/webErrorResponse",
  "http/webFormRequest",
  "jobs/invalidateCacheTagsJob",
  "lifecycle/gracefulShutdown",
  "logging/logger",
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
  "security/stripeWebhook",
  "security/timingSafeCompare",
  "security/tokenExpiry",
  "security/totp",
  "storage/storage",
  "tenant/tenancyConfig",
  "tenant/tenantContext",
  "tenant/tenantDatabaseScope",
  "tenant/databaseTenantContext",
  "tenant/tenantMiddleware",
  "tracing/traceContext",
  "validation/rules",
  "view",
]);

const DEFAULT_TO_NAMED: Record<string, string> = {
  BaseRepository: "database/baseRepository",
  FailedJobRepository: "queue/failedJobRepository",
  FailedJobService: "queue/failedJobService",
};

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(path)));
    } else if (entry.name.endsWith(".ts")) {
      files.push(path);
    }
  }
  return files;
}

function rewrite(content: string): string {
  let next = content;

  next = next.replace(
    /(?:\.\.\/)+src\/core\/([a-zA-Z0-9_/]+)(?:\.ts)?/g,
    (match, subpath: string) => {
      const normalized = subpath.replace(/\.ts$/, "");
      const mapped =
        normalized === "database/seeders/runner"
          ? "database/seeders"
          : normalized.startsWith("database/schema/")
            ? "database/schema"
            : normalized === "view/webLayoutData"
              ? "view"
              : normalized;
      if (SUBPATHS.has(mapped)) {
        return `@getstrata/core/${mapped}`;
      }
      return match;
    },
  );

  for (const [symbol, subpath] of Object.entries(DEFAULT_TO_NAMED)) {
    next = next.replace(
      new RegExp(`import ${symbol} from "@getstrata/core/${subpath}(?:\\.ts)?";`, "g"),
      `import { ${symbol} } from "@getstrata/core/${subpath}";`,
    );
  }

  return next;
}

let changed = 0;

for (const dir of TEST_DIRS) {
  for (const file of await walk(dir)) {
    const before = await readFile(file, "utf8");
    const after = rewrite(before);
    if (after !== before) {
      await writeFile(file, after, "utf8");
      changed += 1;
    }
  }
}

console.log(`Codemodded ${changed} test files.`);
