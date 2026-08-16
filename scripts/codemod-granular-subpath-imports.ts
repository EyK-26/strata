#!/usr/bin/env bun
/** Split imports from shared barrel and root @getstrata/core into granular subpaths. */

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const TARGET_DIRS = [
  join(ROOT, "src"),
  join(ROOT, "tests/unit"),
  join(ROOT, "tests/integration"),
  join(ROOT, "packages/strata-starter/templates/src"),
  join(ROOT, "..", "getstrata", "src"),
  join(ROOT, "..", "getstrata", "content"),
];

const SYMBOL_TARGETS: Record<string, string> = {
  AdminResourceRegistry: "admin/registry",
  formatAdminValue: "admin/formatValue",
  AuthUser: "auth/authContext",
  BaseRepository: "database/baseRepository",
  DatabaseConnection: "database/baseRepository",
  SqlDatabaseConnection: "database/baseRepository",
  createDatabaseConnection: "database/connection",
  mapDatabaseError: "database/errors",
  withDatabaseErrorHandling: "database/errors",
  Model: "database/model",
  applyCasts: "database/model",
  dehydrateValue: "database/model",
  filterMassAssignable: "database/model",
  hydrateValue: "database/model",
  registerModelRepository: "database/model",
  buildAdvancedWhereClause: "database/query",
  buildCountQuery: "database/query",
  buildDeleteByIdQuery: "database/query",
  buildGroupedCountQuery: "database/query",
  buildInsertQuery: "database/query",
  buildJoinClause: "database/query",
  buildOrderByClause: "database/query",
  buildProjectionQuery: "database/query",
  buildQueryWhereClause: "database/query",
  buildRestoreByIdQuery: "database/query",
  buildSelectQuery: "database/query",
  buildSoftDeleteByIdQuery: "database/query",
  buildUpdateQuery: "database/query",
  buildWhereClause: "database/query",
  parseQualifiedColumn: "database/query",
  qualifyColumn: "database/query",
  quoteIdentifier: "database/query",
  resolveQualifiedColumn: "database/query",
  resolveSoftDeleteColumn: "database/query",
  belongsTo: "database/relationships",
  belongsToMany: "database/relationships",
  hasMany: "database/relationships",
  hasOne: "database/relationships",
  indexBelongsToManyRelation: "database/relationships",
  indexBelongsToRelation: "database/relationships",
  indexHasManyRelation: "database/relationships",
  indexHasOneRelation: "database/relationships",
  indexMorphManyRelation: "database/relationships",
  indexMorphOneRelation: "database/relationships",
  indexMorphToRelation: "database/relationships",
  morphMany: "database/relationships",
  morphOne: "database/relationships",
  morphTo: "database/relationships",
  RepositoryQuery: "database/repositoryQuery",
  Blueprint: "database/schema",
  ColumnDefinition: "database/schema",
  Schema: "database/schema",
  compileBlueprint: "database/schema",
  createSchemaBuilder: "database/schema",
  defineTable: "database/table",
  runInTransaction: "database/transaction",
  WhereBuilder: "database/whereBuilder",
  currentAuthUser: "auth/authContext",
  runWithAuthUser: "auth/authContext",
  hasMinimumOrgRole: "auth/membershipContext",
  hasOrgMembership: "auth/membershipContext",
  currentOrganizationIds: "auth/membershipContext",
  membershipContext: "auth/membershipContext",
  isGlobalAdmin: "auth/accessControl",
  resolveUserId: "auth/accessControl",
  requireAuthenticatedUser: "auth/accessControl",
  ROLE_RANK: "auth/accessControl",
  currentTenant: "tenant/tenantContext",
  currentTenantId: "tenant/tenantContext",
  rateLimitMultiplierForPlan: "tenant/tenantContext",
  runWithTenant: "tenant/tenantContext",
  TenantContext: "tenant/tenantContext",
  assertIfMatch: "http/etag",
  applyConditionalGet: "http/etag",
  computeEtagFromJson: "http/etag",
  etagFromResource: "http/etag",
  etagValuesMatch: "http/etag",
  EtagVersioned: "http/etag",
  ifMatchSatisfied: "http/etag",
  ifNoneMatchSatisfied: "http/etag",
  isEtagEnabled: "http/etag",
  notModifiedResponse: "http/etag",
  conditionalJsonResponse: "http/conditionalResponse",
  FormRequest: "http/formRequest",
  QueryFormRequest: "http/formRequest",
  parseMultipartUpload: "http/parseMultipartUpload",
  ParsedUpload: "http/parseMultipartUpload",
  sanitizeUploadFileName: "http/parseMultipartUpload",
  RouteRequest: "http/route",
  getRouteParams: "http/route",
  buildRequestCacheKey: "http/validation",
  expectObject: "http/validation",
  getQueryParams: "http/validation",
  parseJsonBody: "http/validation",
  parseOptionalBooleanQueryParam: "http/validation",
  parseOptionalEnumQueryParam: "http/validation",
  parseOptionalPositiveIntQueryParam: "http/validation",
  parsePositiveIntParam: "http/validation",
  readOptionalEnum: "http/validation",
  readOptionalPositiveInt: "http/validation",
  readOptionalString: "http/validation",
  readRequiredEnum: "http/validation",
  readRequiredPositiveInt: "http/validation",
  readRequiredString: "http/validation",
  paginatedResponse: "http/pagination",
  parsePaginationQuery: "http/pagination",
  buildPaginationMeta: "http/pagination",
  serializeDate: "http/resources",
  toPaginatedResourceCollection: "http/resources",
  toResourceCollection: "http/resources",
  securedBindRouteModel: "http/securedRouteModelBinding",
  securedBindRouteModelByKey: "http/securedRouteModelBinding",
  createdResponse: "http/response",
  errorResponse: "http/response",
  jsonResponse: "http/response",
  noContentResponse: "http/response",
  withErrorHandling: "http/response",
  bindRouteModel: "http/routeModelBinding",
  BadRequestError: "errors/http",
  ConflictError: "errors/http",
  ForbiddenError: "errors/http",
  HttpError: "errors/http",
  NotFoundError: "errors/http",
  PayloadTooLargeError: "errors/http",
  PreconditionFailedError: "errors/http",
  UnauthorizedError: "errors/http",
  UnprocessableEntityError: "errors/http",
  ValidationError: "errors/http",
  jobRegistry: "queue/jobRegistry",
  runQueueJob: "queue/jobRunner",
  collectQueueMetrics: "queue/queueMetrics",
  PaginatedResult: "pagination",
  PaginationMeta: "pagination",
  QueueMetricsSnapshot: "queue/queueMetrics",
  FailedJobService: "queue/failedJobService",
  FailedJobRepository: "queue/failedJobRepository",
  createFailedJobService: "queue/publicQueue",
};

const TYPE_SYMBOLS = new Set([
  "AdminResourceRegistry",
  "AuthUser",
  "DatabaseConnection",
  "EtagVersioned",
  "FailedJobRepository",
  "FailedJobService",
  "PaginatedResult",
  "PaginationMeta",
  "ParsedUpload",
  "QueueMetricsSnapshot",
  "RouteRequest",
  "SqlDatabaseConnection",
  "TenantContext",
]);

const BARREL_SUBPATHS = new Set(["database", "http"]);

type ImportPart = {
  name: string;
  alias?: string;
  isType: boolean;
};

function parseImportParts(specifier: string, forceTypeOnly = false): ImportPart[] {
  return specifier
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const isType = forceTypeOnly || part.startsWith("type ");
      const cleaned = part.startsWith("type ") ? part.slice(5).trim() : part;
      const aliasMatch = cleaned.match(/^(\w+)(?:\s+as\s+(\w+))?$/);
      if (!aliasMatch) {
        return { name: cleaned, isType };
      }
      return {
        name: aliasMatch[1] ?? cleaned,
        alias: aliasMatch[2],
        isType,
      };
    });
}

function formatImportParts(parts: ImportPart[], inlineTypePrefix = true): string {
  return parts
    .map((part) => {
      const symbol = part.alias ? `${part.name} as ${part.alias}` : part.name;
      if (part.isType && inlineTypePrefix) {
        return `type ${symbol}`;
      }
      return symbol;
    })
    .join(", ");
}

function groupImportParts(
  parts: ImportPart[],
  fallbackSubpath?: string,
): { imports: string[]; unresolved: ImportPart[] } {
  const grouped = new Map<string, ImportPart[]>();
  const unresolved: ImportPart[] = [];

  for (const part of parts) {
    const target = SYMBOL_TARGETS[part.name];
    if (!target) {
      unresolved.push(part);
      continue;
    }

    const normalizedPart = TYPE_SYMBOLS.has(part.name) ? { ...part, isType: true } : part;
    const bucket = grouped.get(target) ?? [];
    bucket.push(normalizedPart);
    grouped.set(target, bucket);
  }

  if (fallbackSubpath && unresolved.length > 0) {
    grouped.set(fallbackSubpath, [...(grouped.get(fallbackSubpath) ?? []), ...unresolved]);
    unresolved.length = 0;
  }

  const imports = [...grouped.entries()]
    .filter(([, bucket]) => bucket.length > 0)
    .map(([subpath, bucket]) => {
      const allTypes = bucket.every((part) => part.isType);
      const formatted = formatImportParts(bucket, !allTypes);
      const from = `@getstrata/core/${subpath}`;
      return allTypes
        ? `import type { ${formatted} } from "${from}";`
        : `import { ${formatted} } from "${from}";`;
    });

  return { imports, unresolved };
}

function rewriteBarrelImports(content: string): string {
  return content.replace(
    /import\s+(type\s+)?\{([^}]+)\}\s+from\s+["']@getstrata\/core\/(database|http)["'];?/g,
    (match, typeKeyword, specifier, barrel) => {
      if (!BARREL_SUBPATHS.has(barrel)) {
        return match;
      }

      const { imports, unresolved } = groupImportParts(
        parseImportParts(specifier, Boolean(typeKeyword)),
        barrel,
      );
      if (unresolved.length > 0) {
        return match;
      }
      return imports.length > 0 ? imports.join("\n") : match;
    },
  );
}

function rewriteRootImports(content: string): string {
  return content.replace(
    /import\s+(type\s+)?\{([^}]+)\}\s+from\s+["']@getstrata\/core["'];?/g,
    (match, typeKeyword, specifier) => {
      const { imports, unresolved } = groupImportParts(
        parseImportParts(specifier, Boolean(typeKeyword)),
      );
      if (unresolved.length > 0) {
        return match;
      }
      return imports.length > 0 ? imports.join("\n") : match;
    },
  );
}

function normalizeImportPaths(content: string): string {
  return content.replace(
    /from\s+["']@getstrata\/core\/([a-zA-Z0-9_/]+)\.ts["']/g,
    'from "@getstrata/core/$1"',
  );
}

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") {
        continue;
      }
      files.push(...(await walk(path)));
    } else if (entry.name.endsWith(".ts")) {
      files.push(path);
    }
  }
  return files;
}

let changed = 0;

for (const dir of TARGET_DIRS) {
  let files: string[] = [];
  try {
    files = await walk(dir);
  } catch {
    continue;
  }

  for (const file of files) {
    if (file.endsWith("framework/public-api.ts")) {
      continue;
    }

    const before = await readFile(file, "utf8");
    const after = normalizeImportPaths(rewriteRootImports(rewriteBarrelImports(before)));
    if (after !== before) {
      await writeFile(file, after, "utf8");
      changed += 1;
    }
  }
}

console.log(`Codemodded ${changed} files to granular subpath imports.`);
