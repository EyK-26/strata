import { appDatabaseName } from "./renderEnv.ts";
import {
  authNeedsUsers,
  authUsesCookie,
  authUsesToken,
  type DatabaseLayer,
  nowTimestampLiteral,
  type StarterLayers,
  usesTenantTable,
} from "./types.ts";

function needsEnsure(layers: StarterLayers): boolean {
  return layers.database !== "sqlite";
}

function ensureImport(layers: StarterLayers): string {
  return needsEnsure(layers)
    ? `import { ensureAppDatabase } from "../bootstrap/ensureDatabase.ts";\n`
    : "";
}

function ensureCall(layers: StarterLayers): string {
  return needsEnsure(layers) ? "  await ensureAppDatabase();\n" : "";
}

function dialectFragments(database: DatabaseLayer) {
  if (database === "sqlite") {
    return {
      id: "INTEGER PRIMARY KEY AUTOINCREMENT",
      text: "TEXT",
      keyText: "TEXT",
      defaultText: "TEXT",
      timestamp: "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP",
      timestampNull: "TEXT",
      bool: "INTEGER NOT NULL DEFAULT 0",
    };
  }
  if (database === "mysql") {
    return {
      id: "INT AUTO_INCREMENT PRIMARY KEY",
      text: "TEXT",
      // MySQL rejects TEXT in a key specification without a length (errno 1170)
      // and refuses a DEFAULT on any TEXT column (ER_BLOB_CANT_HAVE_DEFAULT).
      keyText: "VARCHAR(255)",
      defaultText: "VARCHAR(1024)",
      timestamp: "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP",
      timestampNull: "DATETIME NULL",
      bool: "TINYINT(1) NOT NULL DEFAULT 0",
    };
  }
  return {
    id: "SERIAL PRIMARY KEY",
    text: "TEXT",
    keyText: "TEXT",
    defaultText: "TEXT",
    timestamp: "TIMESTAMPTZ NOT NULL DEFAULT NOW()",
    timestampNull: "TIMESTAMPTZ",
    bool: "BOOLEAN NOT NULL DEFAULT FALSE",
  };
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
  const pool = createBunSqlPool({ url, max: 5 }) as SqlDatabaseConnection;
  registerDefaultDatabasePool(pool);
  bindDatabaseConnection(getDefaultDatabaseQuery());
  sql = getDefaultDatabaseQuery() as SqlClient;
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

function renderMigrateTs(layers: StarterLayers): string {
  const d = dialectFragments(layers.database);
  const statements: string[] = [];
  const tenancyOn = usesTenantTable(layers.tenancy);
  const mfaOn = layers.extras.mfa && authNeedsUsers(layers.auth);

  if (tenancyOn) {
    statements.push(`CREATE TABLE IF NOT EXISTS tenant (
    id ${d.id},
    slug ${d.keyText} NOT NULL UNIQUE,
    plan ${d.defaultText} NOT NULL DEFAULT 'enterprise',
    region ${d.defaultText} NOT NULL DEFAULT 'eu'
  )`);
  }

  statements.push(`CREATE TABLE IF NOT EXISTS notes (
    id ${d.id},
    body ${d.text} NOT NULL,
    created_at ${d.timestamp}
  )`);

  if (authNeedsUsers(layers.auth)) {
    const tenantColumn = tenancyOn ? "\n    tenant_id INTEGER NOT NULL DEFAULT 1," : "";
    const mfaColumns = mfaOn
      ? `\n    mfa_secret ${d.text},\n    mfa_enabled ${d.bool},\n    mfa_recovery_codes ${d.text},`
      : "";
    statements.push(`CREATE TABLE IF NOT EXISTS users (
    id ${d.id},
    name ${d.text} NOT NULL,
    email ${d.keyText} NOT NULL UNIQUE,
    password ${d.text} NOT NULL,
    is_admin ${d.bool},${tenantColumn}${mfaColumns}
    email_verified_at ${d.timestampNull},
    created_at ${d.timestamp}
  )`);
  }

  if (authUsesCookie(layers.auth)) {
    statements.push(`CREATE TABLE IF NOT EXISTS sessions (
    id ${d.keyText} PRIMARY KEY,
    user_id INTEGER NOT NULL,
    expires_at ${d.timestamp},
    user_agent ${d.text},
    ip_address ${d.text},
    last_active_at ${d.timestamp}
  )`);
  }

  if (authUsesToken(layers.auth)) {
    statements.push(`CREATE TABLE IF NOT EXISTS api_tokens (
    id ${d.id},
    user_id INTEGER NOT NULL,
    name ${d.text} NOT NULL,
    token_hash ${d.keyText} NOT NULL UNIQUE,
    abilities ${d.defaultText} NOT NULL DEFAULT '[]',
    expires_at ${d.timestampNull},
    last_used_at ${d.timestampNull},
    created_at ${d.timestamp}
  )`);
  }

  const list = statements.map((sql) => `  \`${sql}\`,`).join("\n");

  const ph = layers.database === "postgres";
  const notePlaceholder = ph ? "$1" : "?";
  const verifyOn = layers.extras.emailVerification && authNeedsUsers(layers.auth);
  const userColumns = verifyOn
    ? "name, email, password, is_admin, email_verified_at"
    : "name, email, password, is_admin";
  const userPlaceholders = verifyOn
    ? ph
      ? "$1, $2, $3, $4, $5), ($6, $7, $8, $9, $10"
      : "?, ?, ?, ?, ?), (?, ?, ?, ?, ?"
    : ph
      ? "$1, $2, $3, $4), ($5, $6, $7, $8"
      : "?, ?, ?, ?), (?, ?, ?, ?";
  const adminFlag = ph ? "false" : "0";
  const adminTrue = ph ? "true" : "1";
  const verifiedNow = nowTimestampLiteral(layers.database);
  const userValues = verifyOn
    ? `["Demo User", "demo@example.com", password, ${adminFlag}, ${verifiedNow}, "Admin User", "admin@example.test", password, ${adminTrue}, ${verifiedNow}]`
    : `["Demo User", "demo@example.com", password, ${adminFlag}, "Admin User", "admin@example.test", password, ${adminTrue}]`;

  const seedTenant = tenancyOn
    ? `
  const [{ count: tenantCount }] = await sql.unsafe<{ count: string | number }>(
    "SELECT COUNT(*) AS count FROM tenant",
  );
  if (Number(tenantCount) === 0) {
    await sql.unsafe(
      "INSERT INTO tenant (slug, plan, region) VALUES (${ph ? "$1, $2, $3" : "?, ?, ?"})",
      ["default", "enterprise", "eu"],
    );
  }`
    : "";

  const seedUsers = authNeedsUsers(layers.auth)
    ? `
  const [{ count: userCount }] = await sql.unsafe<{ count: string | number }>(
    "SELECT COUNT(*) AS count FROM users",
  );
  if (Number(userCount) === 0) {
    const password = await hashPassword("password");
    await sql.unsafe(
      "INSERT INTO users (${userColumns}) VALUES (${userPlaceholders})",
      ${userValues},
    );
  }`
    : "";

  const hashImport = authNeedsUsers(layers.auth)
    ? `import { hashPassword } from "@getstrata/core/auth/password";\n`
    : "";

  const seedBlock = `${seedTenant}${seedUsers}`;

  return `${hashImport}${ensureImport(layers)}import { closeDatabase, getSql } from "../bootstrap/database.ts";

const migrations = [
${list}
];

export async function seed() {
${ensureCall(layers)}  const sql = getSql();
  const [{ count }] = await sql.unsafe<{ count: string | number }>(
    "SELECT COUNT(*) AS count FROM notes",
  );
  if (Number(count) === 0) {
    await sql.unsafe("INSERT INTO notes (body) VALUES (${notePlaceholder})", [
      "Welcome to Strata!",
    ]);
  }${seedBlock}
}

export async function migrate() {
${ensureCall(layers)}  const sql = getSql();
  for (const statement of migrations) {
    await sql.unsafe(statement);
  }
  await seed();
}

/** The CLI calls this after migrate() so pooled drivers do not hold the process open. */
export async function close() {
  await closeDatabase();
}

if (import.meta.main) {
  await migrate();
  console.log("Database migrated and seeded.");
  await close();
  process.exit(0);
}
`;
}

function dropTables(layers: StarterLayers): string[] {
  const ordered: string[] = [];
  if (authUsesToken(layers.auth)) {
    ordered.push("api_tokens");
  }
  if (authUsesCookie(layers.auth)) {
    ordered.push("sessions");
  }
  if (authNeedsUsers(layers.auth)) {
    ordered.push("users");
  }
  ordered.push("notes");
  if (usesTenantTable(layers.tenancy)) {
    ordered.push("tenant");
  }
  return ordered;
}

function renderFreshTs(layers: StarterLayers): string {
  const tables = dropTables(layers);
  const cascade = layers.database === "sqlite" ? "" : " CASCADE";
  return `${ensureImport(layers)}import { closeDatabase, getSql } from "../bootstrap/database.ts";
import { migrate } from "./migrate.ts";

const tables = ${JSON.stringify(tables)};

export async function fresh() {
${ensureCall(layers)}  const sql = getSql();
  for (const table of tables) {
    await sql.unsafe(\`DROP TABLE IF EXISTS \${table}${cascade}\`);
  }
  await migrate();
}

/** The CLI calls this after fresh() so pooled drivers do not hold the process open. */
export async function close() {
  await closeDatabase();
}

if (import.meta.main) {
  await fresh();
  console.log("Database reset, migrated, and seeded.");
  await close();
  process.exit(0);
}
`;
}

function renderSeedTs(): string {
  return `import { seed } from "./migrate.ts";

export { seed };

if (import.meta.main) {
  await seed();
  console.log("Database seeded.");
  process.exit(0);
}
`;
}

function renderStatusTs(layers: StarterLayers): string {
  const tables = dropTables(layers);
  return `${ensureImport(layers)}import { getSql } from "../bootstrap/database.ts";

const tables = ${JSON.stringify(tables)};

export async function status() {
${ensureCall(layers)}  const sql = getSql();
  console.log("Starter schema (inline SQL, not a migration runner):");
  for (const table of tables) {
    try {
      const rows = await sql.unsafe<{ count: string | number }>(
        \`SELECT COUNT(*) AS count FROM \${table}\`,
      );
      console.log(\`- [present] \${table} (rows: \${rows[0]?.count ?? 0})\`);
    } catch {
      console.log(\`- [missing] \${table}\`);
    }
  }
}

if (import.meta.main) {
  await status();
  process.exit(0);
}
`;
}

function renderRollbackTs(layers: StarterLayers): string {
  const tables = dropTables(layers);
  const cascade = layers.database === "sqlite" ? "" : " CASCADE";
  return `${ensureImport(layers)}import { getSql } from "../bootstrap/database.ts";

const tables = ${JSON.stringify(tables)};

export async function rollback() {
${ensureCall(layers)}  const sql = getSql();
  for (const table of tables) {
    await sql.unsafe(\`DROP TABLE IF EXISTS \${table}${cascade}\`);
    console.log(\`dropped \${table}\`);
  }
}

if (import.meta.main) {
  await rollback();
  console.log("Rolled back starter tables.");
  process.exit(0);
}
`;
}

function renderPreloadTs(layers: StarterLayers, projectName: string): string {
  const database = appDatabaseName(projectName);
  const fallback =
    layers.database === "sqlite"
      ? "sqlite:./storage/app.sqlite"
      : layers.database === "mysql"
        ? `mysql://root:root@localhost:3306/${database}`
        : `postgresql://postgres:postgres@localhost:5432/${database}`;

  return `import { join } from "node:path";
import { configureModulesDirectory } from "@getstrata/bootstrap/discoverModules";

process.env.DATABASE_URL ??= ${JSON.stringify(fallback)};
process.env.FRONTEND_MODE ??= ${JSON.stringify(layers.frontend)};
process.env.SPA_PREFIX ??= ${JSON.stringify(layers.spaPrefix)};
process.env.CACHE_DRIVER ??= ${JSON.stringify(layers.cache)};
process.env.QUEUE_DRIVER ??= ${JSON.stringify(layers.queue)};
process.env.MAIL_DRIVER ??= ${JSON.stringify(layers.mail)};
process.env.TENANCY_DRIVER ??= ${JSON.stringify(layers.tenancy)};
configureModulesDirectory(join(import.meta.dir, "../modules"));
`;
}

function renderConfigTs(): string {
  return `export interface AppConfig {
  port: number;
  appUrl: string;
  databaseUrl: string;
}

export function loadConfig(): AppConfig {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  return {
    port: Number(process.env.PORT ?? 3000),
    appUrl: process.env.APP_URL ?? "http://localhost:3000",
    databaseUrl,
  };
}

/** Cookie sessions and signed cookies are keyed by this; there is no default. */
export function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET?.trim();
  if (!secret) {
    throw new Error(
      "SESSION_SECRET is required. Copy .env.example to .env and set it (32+ characters).",
    );
  }
  return secret;
}
`;
}

function renderConfigProvider(layers: StarterLayers): string {
  return `import {
  APP_PORT_CONFIG_KEY,
  CORE_CONFIG_TOKEN,
  DATABASE_URL_CONFIG_KEY,
  REDIS_URL_CONFIG_KEY,
} from "@getstrata/bootstrap/config";
import type { ServiceProvider } from "@getstrata/core/contracts/di";
import { loadConfig } from "../config.ts";

const configProvider: ServiceProvider = {
  name: "starter.config",
  register({ container, config }) {
    const appConfig = loadConfig();

    container.set(CORE_CONFIG_TOKEN, config);
    config.set(DATABASE_URL_CONFIG_KEY, appConfig.databaseUrl);
    config.set(APP_PORT_CONFIG_KEY, appConfig.port);
    config.set(REDIS_URL_CONFIG_KEY, process.env.REDIS_URL ?? "");
    config.set("app.url", appConfig.appUrl);
    config.set("cache.driver", process.env.CACHE_DRIVER ?? "${layers.cache}");
    config.set("cache.ttlMs", 3_600_000);
    config.set("cache.maxEntries", 100);
    config.set("queue.driver", process.env.QUEUE_DRIVER ?? "${layers.queue}");
  },
};

export default configProvider;
`;
}

function renderQueueProvider(): string {
  return `import type { ServiceProvider } from "@getstrata/core/contracts/di";
import { CORE_QUEUE_TOKEN } from "@getstrata/core/contracts/serviceTokens";
import {
  createAppQueue,
  createFailedJobService,
  FAILED_JOB_SERVICE_TOKEN,
} from "@getstrata/core/queue/createAppQueue";

const queueProvider: ServiceProvider = {
  name: "starter.queue",
  register({ container }) {
    const driver = (process.env.QUEUE_DRIVER ?? "sync") as "sync" | "async" | "redis";
    const failedJobs = createFailedJobService();
    container.set(FAILED_JOB_SERVICE_TOKEN, failedJobs);
    container.set(CORE_QUEUE_TOKEN, createAppQueue(driver, process.env.REDIS_URL, failedJobs));
  },
};

export default queueProvider;
`;
}

function renderEnsureDatabaseTs(layers: StarterLayers, projectName: string): string | null {
  if (layers.database === "sqlite") {
    return null;
  }

  const database = appDatabaseName(projectName);
  const fallback =
    layers.database === "mysql"
      ? `mysql://root:root@localhost:3306/${database}`
      : `postgresql://postgres:postgres@localhost:5432/${database}`;

  const resolveUrl = `/**
 * The database name comes from DATABASE_URL. Set APP_DATABASE_URL to point
 * migrations and the app at a different database than DATABASE_URL.
 */
function resolveAppDatabaseUrl(): string {
  const explicit = process.env.APP_DATABASE_URL?.trim();
  if (explicit) {
    return explicit;
  }
  return process.env.DATABASE_URL?.trim() || DEFAULT_DATABASE_URL;
}

/** Reject anything we would have to quote before interpolating into DDL. */
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

const DEFAULT_DATABASE_URL = ${JSON.stringify(fallback)};

${resolveUrl}
export async function ensureAppDatabase(): Promise<string> {
  const url = resolveAppDatabaseUrl();
  const name = safeDatabaseName(url);

  const admin = new URL(url);
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

  return `const DEFAULT_DATABASE_URL = ${JSON.stringify(fallback)};

${resolveUrl}
function adminCandidateUrls(url: string): string[] {
  const names = ["postgres", "template1"];
  try {
    const current = decodeURIComponent(new URL(url).pathname.replace(/^\\//, ""));
    if (current && !names.includes(current)) {
      names.push(current);
    }
  } catch {
  }
  return names.map((name) => {
    const admin = new URL(url);
    admin.pathname = \`/\${name}\`;
    return admin.toString();
  });
}

async function openAdminConnection(url: string): Promise<Bun.SQL> {
  let lastError: unknown;
  for (const candidate of adminCandidateUrls(url)) {
    const adminSql = new Bun.SQL(candidate);
    try {
      await adminSql\`SELECT 1\`;
      return adminSql;
    } catch (error) {
      lastError = error;
      await adminSql.close().catch(() => undefined);
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Could not open an admin connection to create the app database.");
}

export async function ensureAppDatabase(): Promise<string> {
  const url = resolveAppDatabaseUrl();
  const name = safeDatabaseName(url);

  const adminSql = await openAdminConnection(url);
  try {
    const rows = await adminSql\`
      SELECT 1 AS ok FROM pg_database WHERE datname = \${name}
    \`;
    if (rows.length === 0) {
      await adminSql.unsafe(\`CREATE DATABASE \${name}\`);
    }
  } finally {
    await adminSql.close();
  }

  process.env.DATABASE_URL = url;
  return url;
}
`;
}

function renderSidecarsTs(_layers: StarterLayers): string | null {
  return null;
}

function renderProvidersIndex(): string {
  return `import type { ServiceProvider } from "@getstrata/core/contracts/di";
import authProvider from "./auth.ts";
import cacheProvider from "./cache.ts";
import configProvider from "./config.ts";
import queueProvider from "./queue.ts";
import storageProvider from "./storage.ts";

const starterProviders: ServiceProvider[] = [
  configProvider,
  cacheProvider,
  storageProvider,
  queueProvider,
  authProvider,
];

export { starterProviders };
`;
}

function renderCreateAppTs(layers: StarterLayers): string {
  const ensureLine = needsEnsure(layers)
    ? `import { ensureAppDatabase } from "./ensureDatabase.ts";\n`
    : "";
  const metricsImport = layers.extras.metrics
    ? `import { createMetricsRoutes } from "@getstrata/bootstrap/metricsRoutes";\n`
    : "";
  const metricsSpread = layers.extras.metrics ? "\n    ...createMetricsRoutes()," : "";
  return `import { join } from "node:path";
import "./preload.ts";
import { runProviderPhase } from "@getstrata/bootstrap/context";
import {
  type AppContext,
  type AppDependencies,
  type AppRouteMap,
  assertAppDependenciesComplete,
  type ConfigStore,
  type MutableAppDependencies,
  type ProviderContext,
  ServiceContainer,
} from "@getstrata/bootstrap/contracts";
import { mergeSpaRoutes } from "@getstrata/bootstrap/createSpaRoutes";
import {
  configureModulesDirectory,
  ensureModulesLoaded,
} from "@getstrata/bootstrap/discoverModules";
import { createHealthRoutes } from "@getstrata/bootstrap/health";
${metricsImport}import { assertProductionSecrets } from "@getstrata/bootstrap/secretsGuard";
import { createWebServer } from "@getstrata/bootstrap/web/server";
import { setActiveApplicationContext } from "@getstrata/core/runtime/applicationRegistry";
import { migrate } from "../db/migrate.ts";
import { buildRoutes } from "../routes.ts";
import { loadConfig } from "./config.ts";
import { getSql } from "./database.ts";
${ensureLine}import { starterProviders } from "./providers/index.ts";

export interface BootstrapOptions {
  migrate?: boolean;
}

export interface BootstrappedApp {
  context: AppContext;
  routes: AppRouteMap;
  config: ReturnType<typeof loadConfig>;
}

class AppConfigStore {
  private readonly values = new Map<string, unknown>();

  set<T>(key: string, value: T): T {
    this.values.set(key, value);
    return value;
  }

  get<T>(key: string): T | undefined {
    return this.values.get(key) as T | undefined;
  }

  require<T>(key: string): T {
    const value = this.get<T>(key);
    if (value === undefined) {
      throw new Error(\`Missing required config value "\${key}".\`);
    }
    return value;
  }

  has(key: string): boolean {
    return this.values.has(key);
  }
}

function createAppContext(): AppContext {
  const container = new ServiceContainer();
  const config = new AppConfigStore() as unknown as ConfigStore;
  const dependencies: MutableAppDependencies = { container };
  const context: ProviderContext = { container, config, dependencies };

  runProviderPhase(starterProviders, "register", context);
  runProviderPhase(starterProviders, "boot", context);

  assertAppDependenciesComplete(dependencies);

  const appContext = { container, config, dependencies: dependencies as AppDependencies };
  setActiveApplicationContext(appContext as never);
  return appContext;
}

export async function bootstrapApp(options: BootstrapOptions = {}): Promise<BootstrappedApp> {
  const isProduction = process.env.APP_ENV === "production";
  // Dev boots migrate for convenience. Production must not mutate schema on
  // start, so run \`strata migrate\` as an explicit deploy step instead.
  const { migrate: runMigrate = !isProduction } = options;

  if (isProduction) {
    assertProductionSecrets();
  }

${needsEnsure(layers) ? "  await ensureAppDatabase();\n" : ""}  const appConfig = loadConfig();
  getSql();
  configureModulesDirectory(join(import.meta.dir, "../modules"));
  await ensureModulesLoaded();
  const context = createAppContext();

  if (runMigrate) {
    await migrate();
  }

  const routes = mergeSpaRoutes(context.dependencies, {
    ...createHealthRoutes(context.dependencies),
    ...buildRoutes(context.dependencies),${metricsSpread}
  }, {
    distDirectory: join(import.meta.dir, "../../frontend/dist"),
  });

  return { context, routes, config: appConfig };
}

export async function createApp(options: BootstrapOptions = {}) {
  return bootstrapApp({ migrate: false, ...options });
}

export function createAppServer(routes: AppRouteMap, port = 0) {
  return createWebServer({
    port,
    publicDir: "./public",
    routes,
  });
}

export { createAppContext };
`;
}

function renderRoutesTs(): string {
  return `import { buildModuleRoutes } from "@getstrata/bootstrap/buildModuleRoutes";
import { buildWebModuleRoutes } from "@getstrata/bootstrap/buildWebModuleRoutes";
import type { AppDependencies, AppRouteMap } from "@getstrata/bootstrap/contracts";

export function buildRoutes(dependencies: AppDependencies): AppRouteMap {
  const api = buildModuleRoutes(dependencies);
  return {
    ...api,
    ...buildWebModuleRoutes(dependencies, { clearRegistry: false }),
  };
}
`;
}

function renderViewTs(layers: StarterLayers): string {
  const authImport = authNeedsUsers(layers.auth)
    ? `import { currentAuthUser } from "@getstrata/core/auth/authContext";
import { resolveCsrfTokenForRequest } from "@getstrata/core/http/csrfToken";
import { currentRequestMeta } from "@getstrata/core/http/requestMetaContext";
import { EtaViewEngine, htmlResponse } from "@getstrata/core/view";
import { starterAuthDirectory } from "../bootstrap/authDirectory.ts";
`
    : `import { resolveCsrfTokenForRequest } from "@getstrata/core/http/csrfToken";
import { currentRequestMeta } from "@getstrata/core/http/requestMetaContext";
import { EtaViewEngine, htmlResponse } from "@getstrata/core/view";
`;

  const userBlock = authNeedsUsers(layers.auth)
    ? `  let currentUser: { id: number; email: string; name: string | null } | null = null;
  const authUser = currentAuthUser();
  if (authUser) {
    try {
      const row = await starterAuthDirectory.findByIdOrThrow(Number(authUser.id));
      currentUser = { id: row.id, email: row.email ?? "", name: row.name ?? null };
    } catch {
      currentUser = null;
    }
  }`
    : `  const currentUser = null;`;

  return `import { join } from "node:path";
${authImport}
const engine = new EtaViewEngine(join(import.meta.dir, "../../views"));

export interface LayoutData {
  title: string;
  description?: string;
}

export async function renderPage(
  template: string,
  data: Record<string, unknown> & { layout: LayoutData },
  request?: Request,
  status = 200,
): Promise<Response> {
  const csrfToken = request ? resolveCsrfTokenForRequest(request) : "";
  const flash = currentRequestMeta().flash ?? null;
${userBlock}
  const html = await engine.render(
    template,
    { ...data, csrfToken, flash, currentUser },
    { request },
  );
  return htmlResponse(html, { status });
}

export function plainText(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
}
`;
}

export {
  dialectFragments,
  renderConfigProvider,
  renderConfigTs,
  renderCreateAppTs,
  renderDatabaseTs,
  renderEnsureDatabaseTs,
  renderFreshTs,
  renderMigrateTs,
  renderPreloadTs,
  renderProvidersIndex,
  renderQueueProvider,
  renderRollbackTs,
  renderRoutesTs,
  renderSeedTs,
  renderSidecarsTs,
  renderStatusTs,
  renderViewTs,
};
