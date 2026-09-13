import { isProductionEnv } from "../runtime/appEnv";

/**
 * Application Postgres login role for FORCE RLS.
 *
 * Superuser (typically `postgres`) may CREATE ROLE, CREATE DATABASE, GRANT,
 * migrate, and migrate:fresh DROP TABLE. Tables are owned by the role that ran
 * CREATE TABLE, so the NOBYPASSRLS runtime role cannot drop them. Runtime
 * DATABASE_URL / APP_DATABASE_URL must be this NOBYPASSRLS role.
 * docker-entrypoint-initdb.d only runs on an empty volume; call
 * ensurePostgresDatabaseAndAppRole() on every boot so existing volumes get the
 * same role and table GRANTs after migrate:fresh.
 *
 * Admin DDL (GRANT ALL TABLES, CREATE TABLE, DROP TABLE) must run on the
 * application database. postgres/template1 are only for CREATE DATABASE.
 */

const POSTGRES_APP_ROLE = "strata_app";
const POSTGRES_APP_ROLE_PASSWORD = "dev-strata-app-change-me";
const POSTGRES_SUPERUSER_PASSWORD = "dev-postgres-change-me";
const LEGACY_POSTGRES_SUPERUSER_PASSWORD = "postgres";

type PostgresSql = {
  unsafe<T>(query: string, params?: readonly unknown[]): Promise<T[]>;
  close?: () => Promise<void> | void;
};

type ConnectPostgres = (url: string) => PostgresSql;

type LivePostgresRole = {
  rolname: string;
  rolsuper: boolean;
  rolbypassrls: boolean;
};

type PostgresAdminOptions = {
  runtimeUrl: string;
  migrationUrl?: string;
  superuserPassword?: string;
  connect?: ConnectPostgres;
};

function assertSafeSqlIdentifier(identifier: string, label: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`Refusing unsafe Postgres ${label}: ${identifier}`);
  }
  return identifier;
}

function quoteSqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function isPostgresUrl(raw: string | undefined): boolean {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) {
    return false;
  }
  try {
    const url = new URL(trimmed);
    return url.protocol === "postgres:" || url.protocol === "postgresql:";
  } catch {
    return false;
  }
}

function postgresUrlUsername(raw: string): string | null {
  if (!isPostgresUrl(raw)) {
    return null;
  }
  return decodeURIComponent(new URL(raw).username);
}

function postgresDatabaseNameFromUrl(raw: string): string {
  let name = "";
  try {
    name = decodeURIComponent(new URL(raw).pathname.replace(/^\//, ""));
  } catch {
    throw new Error(`DATABASE_URL is not a valid URL: ${raw}`);
  }
  if (!name) {
    throw new Error("DATABASE_URL is missing a database name.");
  }
  return assertSafeSqlIdentifier(name, "database name");
}

function withPostgresUrlCredentials(raw: string, username: string, password: string): string {
  const url = new URL(raw);
  url.username = username;
  url.password = password;
  return url.toString();
}

function withPostgresDatabaseName(raw: string, database: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
      return null;
    }
    url.pathname = `/${database}`;
    return url.toString();
  } catch {
    return null;
  }
}

function uniqueUrls(urls: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const url of urls) {
    const trimmed = url?.trim() ?? "";
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function postgresAdminUrls(options: {
  runtimeUrl: string;
  migrationUrl?: string;
  superuserPassword?: string;
}): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  const push = (url: string | undefined) => {
    const trimmed = url?.trim() ?? "";
    if (!trimmed || seen.has(trimmed)) {
      return;
    }
    seen.add(trimmed);
    urls.push(trimmed);
  };

  push(options.migrationUrl);
  if (!isPostgresUrl(options.runtimeUrl)) {
    return urls;
  }

  const superuserPassword = options.superuserPassword ?? POSTGRES_SUPERUSER_PASSWORD;
  push(withPostgresUrlCredentials(options.runtimeUrl, "postgres", superuserPassword));
  // Last-resort password "postgres" is admin fallback only, and only when APP_ENV is local.
  // Not a runtime URL. with-host-env.sh must not point APP_DATABASE_URL here.
  if (!isProductionEnv()) {
    push(
      withPostgresUrlCredentials(
        options.runtimeUrl,
        "postgres",
        LEGACY_POSTGRES_SUPERUSER_PASSWORD,
      ),
    );
  }
  return urls;
}

function resolveTargetDatabaseName(options: {
  runtimeUrl: string;
  migrationUrl?: string;
}): string | null {
  if (isPostgresUrl(options.runtimeUrl)) {
    return postgresDatabaseNameFromUrl(options.runtimeUrl);
  }
  const migrationUrl = options.migrationUrl?.trim() ?? "";
  if (isPostgresUrl(migrationUrl)) {
    return postgresDatabaseNameFromUrl(migrationUrl);
  }
  return null;
}

function defaultConnect(url: string): PostgresSql {
  return new Bun.SQL(url);
}

async function closePostgres(sql: PostgresSql): Promise<void> {
  if (!sql.close) {
    return;
  }
  try {
    await sql.close();
  } catch {
    // ignore close failures after a failed ping or when the caller already closed
  }
}

async function pingPostgres(sql: PostgresSql): Promise<void> {
  await sql.unsafe("SELECT 1");
}

async function connectFirstSuccessful(
  urls: string[],
  connect: ConnectPostgres,
): Promise<PostgresSql> {
  let lastError: unknown;
  for (const candidate of urls) {
    const sql = connect(candidate);
    try {
      await pingPostgres(sql);
      return sql;
    } catch (error) {
      lastError = error;
      await closePostgres(sql);
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(
        "Could not open a Postgres superuser connection for CREATE ROLE / CREATE DATABASE / GRANT. Set MIGRATION_DATABASE_URL.",
      );
}

async function openPostgresAdminConnection(options: PostgresAdminOptions): Promise<PostgresSql> {
  const connect = options.connect ?? defaultConnect;
  const target = resolveTargetDatabaseName(options);
  const candidates = uniqueUrls(
    postgresAdminUrls(options).map((url) =>
      target ? (withPostgresDatabaseName(url, target) ?? url) : url,
    ),
  );
  return await connectFirstSuccessful(candidates, connect);
}

async function openPostgresMaintenanceConnection(
  options: PostgresAdminOptions,
): Promise<PostgresSql> {
  const connect = options.connect ?? defaultConnect;
  const candidates: Array<string | null> = [];
  for (const url of postgresAdminUrls(options)) {
    candidates.push(withPostgresDatabaseName(url, "postgres"));
    candidates.push(withPostgresDatabaseName(url, "template1"));
    candidates.push(url);
  }
  return await connectFirstSuccessful(uniqueUrls(candidates), connect);
}

function postgresAppRoleCreateSql(options: { role?: string; password?: string } = {}): string {
  const role = assertSafeSqlIdentifier(options.role ?? POSTGRES_APP_ROLE, "role name");
  const password = quoteSqlLiteral(options.password ?? POSTGRES_APP_ROLE_PASSWORD);
  return `DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN
    CREATE ROLE ${role} LOGIN PASSWORD ${password}
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  ELSE
    ALTER ROLE ${role} WITH LOGIN PASSWORD ${password}
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$$`;
}

function postgresAppRoleSql(options: {
  database: string;
  role?: string;
  password?: string;
}): string {
  const database = assertSafeSqlIdentifier(options.database, "database name");
  const role = assertSafeSqlIdentifier(options.role ?? POSTGRES_APP_ROLE, "role name");
  return `-- Application login role. FORCE RLS applies because this role is NOSUPERUSER and NOBYPASSRLS.
-- Superuser remains for CREATE ROLE / CREATE DATABASE / GRANT / migrate / migrate:fresh DROP.
-- This script is repeatable on an already-existing volume (not only docker-entrypoint-initdb.d).
${postgresAppRoleCreateSql(options)};

GRANT CONNECT ON DATABASE ${database} TO ${role};
GRANT USAGE, CREATE ON SCHEMA public TO ${role};
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO ${role};
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO ${role};
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ${role};
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO ${role};
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO ${role};
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO ${role};
`;
}

async function grantPostgresAppRolePrivileges(
  sql: PostgresSql,
  options: { database: string; role?: string },
): Promise<void> {
  const database = assertSafeSqlIdentifier(options.database, "database name");
  const role = assertSafeSqlIdentifier(options.role ?? POSTGRES_APP_ROLE, "role name");
  await sql.unsafe(`GRANT CONNECT ON DATABASE ${database} TO ${role}`);
  await sql.unsafe(`GRANT USAGE, CREATE ON SCHEMA public TO ${role}`);
  await sql.unsafe(`GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO ${role}`);
  await sql.unsafe(`GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO ${role}`);
  await sql.unsafe(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ${role}`);
  await sql.unsafe(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO ${role}`);
  await sql.unsafe(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO ${role}`);
  await sql.unsafe(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO ${role}`,
  );
}

async function ensurePostgresAppRole(
  sql: PostgresSql,
  options: { database: string; role?: string; password?: string },
): Promise<void> {
  await sql.unsafe(postgresAppRoleCreateSql(options));
  await grantPostgresAppRolePrivileges(sql, options);
}

async function ensurePostgresDatabaseAndAppRole(options: {
  runtimeUrl: string;
  migrationUrl?: string;
  role?: string;
  password?: string;
  connect?: ConnectPostgres;
}): Promise<string> {
  const name = postgresDatabaseNameFromUrl(options.runtimeUrl);
  const maintenance = await openPostgresMaintenanceConnection(options);
  try {
    const rows = await maintenance.unsafe<{ ok: number }>(
      "SELECT 1 AS ok FROM pg_database WHERE datname = $1",
      [name],
    );
    if (rows.length === 0) {
      await maintenance.unsafe(`CREATE DATABASE ${name}`);
    }
  } finally {
    await closePostgres(maintenance);
  }

  const admin = await openPostgresAdminConnection(options);
  try {
    await ensurePostgresAppRole(admin, {
      database: name,
      role: options.role,
      password: options.password ?? process.env.STRATA_APP_PASSWORD ?? POSTGRES_APP_ROLE_PASSWORD,
    });
  } finally {
    await closePostgres(admin);
  }
  return options.runtimeUrl;
}

async function dropPostgresTablesAsAdmin(
  tables: readonly string[],
  options: PostgresAdminOptions,
): Promise<void> {
  const safeTables = tables.map((table) => assertSafeSqlIdentifier(table, "table name"));
  const sql = await openPostgresAdminConnection(options);
  try {
    for (const table of safeTables) {
      await sql.unsafe(`DROP TABLE IF EXISTS ${table} CASCADE`);
    }
  } finally {
    await closePostgres(sql);
  }
}

async function inspectCurrentPostgresRole(sql: PostgresSql): Promise<LivePostgresRole | null> {
  const rows = await sql.unsafe<LivePostgresRole>(
    `SELECT current_user AS rolname, r.rolsuper, r.rolbypassrls
     FROM pg_roles r WHERE r.rolname = current_user`,
  );
  return rows[0] ?? null;
}

function assertPostgresRoleCannotBypassRls(
  role: LivePostgresRole | null,
  source = "DATABASE_URL",
): void {
  if (!role) {
    throw new Error(
      `Production startup blocked: could not inspect the live Postgres role for ${source}.`,
    );
  }
  if (role.rolsuper || role.rolbypassrls) {
    throw new Error(
      `Production startup blocked: ${source} role ${role.rolname} is rolsuper or rolbypassrls. FORCE RLS does not apply. Use a NOBYPASSRLS login role.`,
    );
  }
}

export type { ConnectPostgres, LivePostgresRole, PostgresSql };
export {
  assertPostgresRoleCannotBypassRls,
  assertSafeSqlIdentifier,
  dropPostgresTablesAsAdmin,
  ensurePostgresAppRole,
  ensurePostgresDatabaseAndAppRole,
  grantPostgresAppRolePrivileges,
  inspectCurrentPostgresRole,
  isPostgresUrl,
  LEGACY_POSTGRES_SUPERUSER_PASSWORD,
  openPostgresAdminConnection,
  POSTGRES_APP_ROLE,
  POSTGRES_APP_ROLE_PASSWORD,
  POSTGRES_SUPERUSER_PASSWORD,
  postgresAdminUrls,
  postgresAppRoleCreateSql,
  postgresAppRoleSql,
  postgresDatabaseNameFromUrl,
  postgresUrlUsername,
  quoteSqlLiteral,
};
