import { defaultDatabaseUrl } from "./databaseDefaults.ts";
import type { DatabaseLayer, StarterLayers } from "./types.ts";

function needsEnsure(layers: StarterLayers): boolean {
  return layers.database !== "sqlite";
}

function driverName(database: DatabaseLayer): "pgsql" | "mysql" | "sqlite" {
  return database === "postgres" ? "pgsql" : database;
}

function renderDatabaseTs(layers: StarterLayers): string {
  const driver = driverName(layers.database);

  if (layers.database === "sqlite") {
    return `import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { SqlDatabaseConnection } from "@getstrata/core/database/baseRepository";
import { bindDatabaseConnection } from "@getstrata/core/database/boundConnection";
import { registerDefaultDatabasePool } from "@getstrata/core/database/defaultConnection";
import { createSqliteConnection } from "@getstrata/core/database/sqliteConnection";
import { useSqlDialect } from "@getstrata/core/database/dialect";

export type SqlClient = {
  unsafe<T>(query: string, params?: readonly unknown[]): Promise<T[]>;
  close?: () => Promise<void> | void;
};

let sql: SqlClient | null = null;

function sqliteFilename(url: string): string {
  const trimmed = url.trim();
  if (trimmed === ":memory:" || trimmed === "sqlite::memory:") {
    return ":memory:";
  }
  if (trimmed.startsWith("sqlite:")) {
    return trimmed.slice("sqlite:".length).replace(/^\\/\\//, "") || "./storage/app.sqlite";
  }
  return trimmed || "./storage/app.sqlite";
}

function asSqlPool(client: SqlClient): SqlDatabaseConnection {
  const tagged = async () => {
    throw new Error(
      "SQLite starter connections do not run tagged SQL. Keep TENANCY_DRIVER=none or use Postgres.",
    );
  };
  return Object.assign(tagged, client) as SqlDatabaseConnection;
}

export function getSql(): SqlClient {
  if (sql) {
    return sql;
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is required");
  }

  useSqlDialect("${driver}");
  const filename = sqliteFilename(url);
  if (filename !== ":memory:") {
    mkdirSync(dirname(filename), { recursive: true });
  }
  sql = createSqliteConnection(filename);
  bindDatabaseConnection(sql);
  registerDefaultDatabasePool(asSqlPool(sql));
  return sql;
}

export async function pingDatabase(): Promise<boolean> {
  try {
    await getSql().unsafe("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

export async function closeDatabase() {
  if (sql?.close) {
    await sql.close();
  }
  sql = null;
}
`;
  }

  if (layers.database === "mysql") {
    return `import { bindDatabaseConnection } from "@getstrata/core/database/boundConnection";
import type { SqlDatabaseConnection } from "@getstrata/core/database/baseRepository";
import { registerDefaultDatabasePool } from "@getstrata/core/database/defaultConnection";
import { createMysqlConnection } from "@getstrata/core/database/mysqlConnection";
import { useSqlDialect } from "@getstrata/core/database/dialect";

export type SqlClient = {
  unsafe<T>(query: string, params?: readonly unknown[]): Promise<T[]>;
  close?: () => Promise<void> | void;
};

let sql: SqlClient | null = null;

export function getSql(): SqlClient {
  if (sql) {
    return sql;
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is required");
  }

  useSqlDialect("${driver}");
  sql = createMysqlConnection(url);
  bindDatabaseConnection(sql);
  registerDefaultDatabasePool(sql as SqlDatabaseConnection);
  return sql;
}

export async function pingDatabase(): Promise<boolean> {
  try {
    await getSql().unsafe("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

export async function closeDatabase() {
  if (sql?.close) {
    await sql.close();
  }
  sql = null;
}
`;
  }

  return `import { createBunSqlPool } from "@getstrata/core/database/bunSql";
import type { SqlDatabaseConnection } from "@getstrata/core/database/baseRepository";
import { bindDatabaseConnection } from "@getstrata/core/database/boundConnection";
import {
  getDefaultDatabaseQuery,
  registerDefaultDatabasePool,
} from "@getstrata/core/database/defaultConnection";
import { useSqlDialect } from "@getstrata/core/database/dialect";

export type SqlClient = SqlDatabaseConnection;

let sql: SqlClient | null = null;

export function getSql(): SqlClient {
  if (sql) {
    return sql;
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is required");
  }

  useSqlDialect("${driver}");
  const pool = createBunSqlPool({ url, max: 5 }) as SqlDatabaseConnection;
  registerDefaultDatabasePool(pool);
  bindDatabaseConnection(getDefaultDatabaseQuery());
  sql = getDefaultDatabaseQuery();
  return sql;
}

export async function pingDatabase(): Promise<boolean> {
  try {
    await getSql().unsafe("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

export async function closeDatabase() {
  if (sql?.close) {
    await sql.close();
  }
  sql = null;
}
`;
}

function renderEnsureDatabaseTs(layers: StarterLayers, projectName: string): string | null {
  if (layers.database === "sqlite") {
    return null;
  }

  const fallback = defaultDatabaseUrl(layers, projectName);

  const resolveUrl = `/**
 * Runtime URL. Superuser CREATE ROLE / CREATE DATABASE / GRANT / migrate uses
 * MIGRATION_DATABASE_URL when set.
 */
function resolveAppDatabaseUrl(): string {
  const explicit = process.env.APP_DATABASE_URL?.trim();
  if (explicit) {
    return explicit;
  }
  const configured = process.env.DATABASE_URL?.trim();
  if (configured) return configured;
  if (isProductionEnv()) throw new Error("DATABASE_URL or APP_DATABASE_URL is required in production/staging.");
  return DEFAULT_DATABASE_URL;
}
`;

  const safeName = `/** Reject anything we would have to quote before interpolating into DDL. */
function safeDatabaseName(url: string): string {
  let name = "";
  try {
    name = decodeURIComponent(new URL(url).pathname.replace(/^\\//, ""));
  } catch {
    throw new Error(\`DATABASE_URL is not a valid URL: \${url}\`);
  }
  if (!name) {
    throw new Error("DATABASE_URL is missing a database name.");
  }
  if (name.replace(/[^A-Za-z0-9_]/g, "") !== name) {
    throw new Error(\`Refusing to create a database with an unsafe name: \${name}\`);
  }
  return name;
}
`;

  if (layers.database === "mysql") {
    return `import { createConnection } from "mysql2/promise";
import { isProductionEnv } from "@getstrata/core/runtime/appEnv";

const DEFAULT_DATABASE_URL = ${JSON.stringify(fallback)};

${resolveUrl}${safeName}
export async function ensureAppDatabase(options: { provision?: boolean } = {}): Promise<string> {
  const url = resolveAppDatabaseUrl();
  if (!(options.provision ?? !isProductionEnv())) {
    process.env.DATABASE_URL = url;
    return url;
  }
  const name = safeDatabaseName(url);

  // Explicit schema operations use the administrative connection when supplied.
  const admin = new URL(process.env.MIGRATION_DATABASE_URL?.trim() || url);
  admin.pathname = "/";
  const connection = await createConnection(admin.toString());
  try {
    await connection.query(\`CREATE DATABASE IF NOT EXISTS \${name}\`);
  } finally {
    await connection.end();
  }

  process.env.DATABASE_URL = url;
  return url;
}
`;
  }

  return `import {
  ensurePostgresDatabaseAndAppRole,
  POSTGRES_APP_ROLE_PASSWORD,
} from "@getstrata/core/tenant/enableTenantRls";
import { isProductionEnv } from "@getstrata/core/runtime/appEnv";

const DEFAULT_DATABASE_URL = ${JSON.stringify(fallback)};

${resolveUrl}
export async function ensureAppDatabase(options: { provision?: boolean } = {}): Promise<string> {
  const url = resolveAppDatabaseUrl();
  if (options.provision ?? !isProductionEnv()) {
    if (isProductionEnv()) {
      if (!process.env.MIGRATION_DATABASE_URL?.trim()) throw new Error("MIGRATION_DATABASE_URL is required for production/staging provisioning.");
      const password = process.env.STRATA_APP_PASSWORD?.trim();
      if (!password || password === POSTGRES_APP_ROLE_PASSWORD) throw new Error("Set an explicit non-development STRATA_APP_PASSWORD for production/staging provisioning.");
    }
    await ensurePostgresDatabaseAndAppRole({
      runtimeUrl: url,
      migrationUrl: process.env.MIGRATION_DATABASE_URL,
      password: process.env.STRATA_APP_PASSWORD ?? POSTGRES_APP_ROLE_PASSWORD,
    });
  }
  process.env.DATABASE_URL = url;
  return url;
}
`;
}

function renderSidecarsTs(_layers: StarterLayers): string | null {
  return null;
}

export { needsEnsure, renderDatabaseTs, renderEnsureDatabaseTs, renderSidecarsTs };
