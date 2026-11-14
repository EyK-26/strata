import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { runWithSqlDialect } from "@getstrata/core/database/dialect";
import type { MigrationDatabase } from "@getstrata/core/database/migrations/types";
import type { DatabaseConnectionOptions } from "@getstrata/core/database/session";
import { isProductionEnv } from "@getstrata/core/runtime/appEnv";
import {
  ensurePostgresDatabaseAndAppRole,
  POSTGRES_APP_ROLE_PASSWORD,
} from "@getstrata/core/tenant/enableTenantRls";

type Environment = Readonly<Record<string, string | undefined>>;
type Driver = DatabaseConnectionOptions["driver"];

/** Resolve a configuration snapshot without opening a connection or mutating the environment. */
export function resolveDatabaseOptions(
  environment: Environment,
  defaults: { driver: Driver; defaultUrl?: string; root?: string },
): DatabaseConnectionOptions {
  const production = isProductionEnv(environment);
  const url =
    environment.APP_DATABASE_URL?.trim() ||
    environment.DATABASE_URL?.trim() ||
    (!production || defaults.driver === "sqlite" ? defaults.defaultUrl : undefined);
  if (!url) throw new Error("DATABASE_URL or APP_DATABASE_URL is required in production/staging.");
  if (defaults.driver === "sqlite") {
    const value = url.trim();
    const filename =
      value === ":memory:" || value === "sqlite::memory:"
        ? ":memory:"
        : value.startsWith("sqlite:")
          ? value.slice(7).replace(/^\/\//, "") || "./storage/app.sqlite"
          : value;
    return Object.freeze({
      driver: "sqlite",
      filename:
        filename === ":memory:" ? filename : resolve(defaults.root ?? process.cwd(), filename),
    });
  }
  return defaults.driver === "pgsql"
    ? Object.freeze({ driver: "pgsql", url, max: 5 })
    : Object.freeze({ driver: "mysql", url });
}

function safeDatabaseName(url: string): string {
  let name: string;
  try {
    name = decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
  } catch {
    throw new Error("DATABASE_URL is not a valid database URL.");
  }
  if (!name) throw new Error("DATABASE_URL is missing a database name.");
  if (!/^[A-Za-z0-9_]+$/.test(name))
    throw new Error(`Refusing to create a database with an unsafe name: ${name}`);
  return name;
}

interface ProvisionDatabaseOptions {
  readonly driver: "pgsql" | "mysql";
  readonly runtimeUrl: string;
  readonly migrationUrl?: string;
  readonly password?: string;
  readonly production: boolean;
  readonly provision?: boolean;
}
/** Provision only when explicitly selected, with production defaulting to resolution only. */
export async function ensureDatabase(options: ProvisionDatabaseOptions): Promise<string> {
  if (!(options.provision ?? !options.production)) return options.runtimeUrl;
  if (options.driver === "pgsql") {
    if (options.production) {
      if (!options.migrationUrl?.trim())
        throw new Error("MIGRATION_DATABASE_URL is required for production/staging provisioning.");
      if (!options.password?.trim() || options.password === POSTGRES_APP_ROLE_PASSWORD)
        throw new Error(
          "Set an explicit non-development STRATA_APP_PASSWORD for production/staging provisioning.",
        );
    }
    await ensurePostgresDatabaseAndAppRole({
      runtimeUrl: options.runtimeUrl,
      migrationUrl: options.migrationUrl,
      password: options.password ?? POSTGRES_APP_ROLE_PASSWORD,
    });
  } else {
    const name = safeDatabaseName(options.runtimeUrl);
    const admin = new URL(options.migrationUrl?.trim() || options.runtimeUrl);
    admin.pathname = "/";
    const { createConnection } = await import("mysql2/promise");
    const connection = await createConnection(admin.toString());
    try {
      await connection.query(`CREATE DATABASE IF NOT EXISTS ${name}`);
    } finally {
      await connection.end();
    }
  }
  return options.runtimeUrl;
}

/** Schema commands own one connection, including dialect selection, grants and cleanup. */
export async function withMigrationDatabase<T>(
  options: DatabaseConnectionOptions,
  operation: (database: MigrationDatabase) => Promise<T>,
  controls: { readonly environment?: Environment; readonly grantRuntimePrivileges?: boolean } = {},
): Promise<T> {
  const environment = Object.freeze({ ...(controls.environment ?? process.env) });
  let connection: MigrationDatabase & { close?: () => void | Promise<void> };
  if (options.driver === "pgsql") {
    const { openPostgresAdminConnection } = await import("@getstrata/core/tenant/enableTenantRls");
    connection = await openPostgresAdminConnection({
      runtimeUrl: options.url,
      migrationUrl: environment.MIGRATION_DATABASE_URL,
    });
  } else if (options.driver === "mysql") {
    const { createMysqlConnection } = await import("@getstrata/core/database/mysqlConnection");
    connection = createMysqlConnection(environment.MIGRATION_DATABASE_URL?.trim() || options.url);
  } else {
    if (options.filename !== ":memory:") mkdirSync(dirname(options.filename), { recursive: true });
    const { createSqliteConnection } = await import("@getstrata/core/database/sqliteConnection");
    connection = createSqliteConnection(options.filename);
  }
  try {
    const result = await runWithSqlDialect(options.driver, () => operation(connection));
    if (options.driver === "pgsql" && controls.grantRuntimePrivileges !== false) {
      const { grantPostgresAppRolePrivileges, postgresDatabaseNameFromUrl } = await import(
        "@getstrata/core/tenant/enableTenantRls"
      );
      await grantPostgresAppRolePrivileges(connection, {
        database: postgresDatabaseNameFromUrl(options.url),
      });
    }
    return result;
  } finally {
    await connection.close?.();
  }
}
