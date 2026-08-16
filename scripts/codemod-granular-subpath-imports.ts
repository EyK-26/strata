#!/usr/bin/env bun
/** Split imports from shared barrel subpaths into granular @getstrata/core/* paths. */

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const TARGET_DIRS = [join(ROOT, "tests/unit"), join(ROOT, "tests/integration")];

const SYMBOL_TARGETS: Record<string, string> = {
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
  assertIfMatch: "http/etag",
  computeEtagFromJson: "http/etag",
  etagFromResource: "http/etag",
  etagValuesMatch: "http/etag",
  ifMatchSatisfied: "http/etag",
  ifNoneMatchSatisfied: "http/etag",
  isEtagEnabled: "http/etag",
  notModifiedResponse: "http/etag",
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
};

const TYPE_SYMBOLS = new Set(["DatabaseConnection", "SqlDatabaseConnection"]);
const BARREL_SUBPATHS = new Set(["database", "http"]);

type ImportPart = {
  name: string;
  alias?: string;
  isType: boolean;
};

function parseImportParts(specifier: string): ImportPart[] {
  return specifier
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const isType = part.startsWith("type ");
      const cleaned = isType ? part.slice(5).trim() : part;
      const aliasMatch = cleaned.match(/^(\w+)(?:\s+as\s+(\w+))?$/);
      if (!aliasMatch) {
        return { name: cleaned, isType };
      }
      return {
        name: aliasMatch[1]!,
        alias: aliasMatch[2],
        isType,
      };
    });
}

function formatImportParts(parts: ImportPart[]): string {
  return parts
    .map((part) => {
      const symbol = part.alias ? `${part.name} as ${part.alias}` : part.name;
      return part.isType ? `type ${symbol}` : symbol;
    })
    .join(", ");
}

function rewriteBarrelImports(content: string): string {
  return content.replace(
    /import\s+(type\s+)?\{([^}]+)\}\s+from\s+["']@getstrata\/core\/(database|http)["'];?/g,
    (match, typeKeyword, specifier, barrel) => {
      if (!BARREL_SUBPATHS.has(barrel)) {
        return match;
      }

      const parts = parseImportParts(specifier);
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

      if (unresolved.length > 0) {
        const remaining = formatImportParts(unresolved);
        grouped.set(barrel, grouped.get(barrel) ?? []);
        if (remaining.length > 0) {
          grouped.set(barrel, [...(grouped.get(barrel) ?? []), ...unresolved]);
        }
      }

      const imports = [...grouped.entries()]
        .filter(([, bucket]) => bucket.length > 0)
        .map(([subpath, bucket]) => {
          const formatted = formatImportParts(bucket);
          const from =
            subpath === barrel ? `@getstrata/core/${barrel}` : `@getstrata/core/${subpath}`;
          return typeKeyword && bucket.every((part) => part.isType)
            ? `import type { ${formatted} } from "${from}";`
            : `import { ${formatted} } from "${from}";`;
        });

      return imports.join("\n");
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
      files.push(...(await walk(path)));
    } else if (entry.name.endsWith(".ts")) {
      files.push(path);
    }
  }
  return files;
}

let changed = 0;

for (const dir of TARGET_DIRS) {
  for (const file of await walk(dir)) {
    const before = await readFile(file, "utf8");
    const after = normalizeImportPaths(rewriteBarrelImports(before));
    if (after !== before) {
      await writeFile(file, after, "utf8");
      changed += 1;
    }
  }
}

console.log(`Codemodded ${changed} files to granular subpath imports.`);
