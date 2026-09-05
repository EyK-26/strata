import {
  authNeedsUsers,
  authUsesCookie,
  authUsesToken,
  type DatabaseLayer,
  type StarterLayers,
} from "./types.ts";

function dialectFragments(database: DatabaseLayer) {
  if (database === "sqlite") {
    return {
      id: "INTEGER PRIMARY KEY AUTOINCREMENT",
      text: "TEXT",
      timestamp: "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP",
      timestampNull: "TEXT",
      bool: "INTEGER NOT NULL DEFAULT 0",
    };
  }
  if (database === "mysql") {
    return {
      id: "INT AUTO_INCREMENT PRIMARY KEY",
      text: "TEXT",
      timestamp: "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP",
      timestampNull: "DATETIME NULL",
      bool: "TINYINT(1) NOT NULL DEFAULT 0",
    };
  }
  return {
    id: "SERIAL PRIMARY KEY",
    text: "TEXT",
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

  return `import { bindBunSql, createBunSqlPool } from "@getstrata/core/database/bunSql";
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
  sql = bindBunSql(createBunSqlPool({ url, max: 5 })) as SqlClient;
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
  const statements: string[] = [
    `CREATE TABLE IF NOT EXISTS notes (
    id ${d.id},
    body ${d.text} NOT NULL,
    created_at ${d.timestamp}
  )`,
  ];

  if (authNeedsUsers(layers.auth)) {
    statements.push(`CREATE TABLE IF NOT EXISTS users (
    id ${d.id},
    name ${d.text} NOT NULL,
    email ${d.text} NOT NULL UNIQUE,
    password ${d.text} NOT NULL,
    is_admin ${d.bool},
    email_verified_at ${d.timestampNull},
    created_at ${d.timestamp}
  )`);
  }

  if (authUsesCookie(layers.auth)) {
    statements.push(`CREATE TABLE IF NOT EXISTS sessions (
    id ${d.text} PRIMARY KEY,
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
    token_hash ${d.text} NOT NULL UNIQUE,
    abilities ${d.text} NOT NULL DEFAULT '[]',
    expires_at ${d.timestampNull},
    last_used_at ${d.timestampNull},
    created_at ${d.timestamp}
  )`);
  }

  const list = statements.map((sql) => `  \`${sql}\`,`).join("\n");

  const ph = layers.database === "postgres";
  const notePlaceholder = ph ? "$1" : "?";
  const userPlaceholders = ph ? "$1, $2, $3, $4), ($5, $6, $7, $8" : "?, ?, ?, ?), (?, ?, ?, ?";
  const adminFlag = ph ? "false, " : "0, ";
  const adminTrue = ph ? "true" : "1";

  const seedUsers = authNeedsUsers(layers.auth)
    ? `
  const [{ count: userCount }] = await sql.unsafe<Array<{ count: string | number }>>(
    "SELECT COUNT(*) AS count FROM users",
  );
  if (Number(userCount) === 0) {
    const password = await hashPassword("password");
    await sql.unsafe(
      "INSERT INTO users (name, email, password, is_admin) VALUES (${userPlaceholders})",
      ["Demo User", "demo@example.com", password, ${adminFlag}"Admin User", "admin@example.test", password, ${adminTrue}],
    );
  }`
    : "";

  const hashImport = authNeedsUsers(layers.auth)
    ? `import { hashPassword } from "@getstrata/core/auth/password";\n`
    : "";

  const seedBlock = seedUsers;

  return `${hashImport}import { getSql } from "../bootstrap/database.ts";

const migrations = [
${list}
];

export async function migrate() {
  const sql = getSql();
  for (const statement of migrations) {
    await sql.unsafe(statement);
  }
}

export async function seed() {
  const sql = getSql();
  const [{ count }] = await sql.unsafe<Array<{ count: string | number }>>(
    "SELECT COUNT(*) AS count FROM notes",
  );
  if (Number(count) === 0) {
    await sql.unsafe("INSERT INTO notes (body) VALUES (${notePlaceholder})", [
      "Welcome to Strata!",
    ]);
  }${seedBlock}
}

if (import.meta.main) {
  await migrate();
  await seed();
  console.log("Database migrated and seeded.");
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
  return ordered;
}

function renderFreshTs(layers: StarterLayers): string {
  const tables = dropTables(layers);
  const cascade = layers.database === "sqlite" ? "" : " CASCADE";
  return `import { getSql } from "../bootstrap/database.ts";
import { migrate, seed } from "./migrate.ts";

const tables = ${JSON.stringify(tables)};

export async function fresh() {
  const sql = getSql();
  for (const table of tables) {
    await sql.unsafe(\`DROP TABLE IF EXISTS \${table}${cascade}\`);
  }
  await migrate();
  await seed();
}

if (import.meta.main) {
  await fresh();
  console.log("Database reset, migrated, and seeded.");
  process.exit(0);
}
`;
}

function renderPreloadTs(layers: StarterLayers, projectName: string): string {
  const fallback =
    layers.database === "sqlite"
      ? "sqlite:./storage/app.sqlite"
      : layers.database === "mysql"
        ? `mysql://root:root@localhost:3306/${projectName}`
        : `postgresql://postgres:postgres@localhost:5432/${projectName}`;

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

function renderSidecarsTs(layers: StarterLayers): string | null {
  if (!layers.extras.sqliteKiosk && !layers.extras.mysqlMirror) {
    return null;
  }

  return `import { createMysqlConnection } from "@getstrata/core/database/mysqlConnection";
import {
  hasNamedConnection,
  registerNamedConnection,
} from "@getstrata/core/database/namedConnections";
import { createSqliteConnection } from "@getstrata/core/database/sqliteConnection";

let bound = false;

export function bindSidecars() {
  if (bound) {
    return;
  }
  bound = true;

  const sqlitePath = process.env.KIOSK_SQLITE?.trim();
  if (sqlitePath && !hasNamedConnection("kiosk")) {
    registerNamedConnection("kiosk", "sqlite", createSqliteConnection(sqlitePath));
  }

  const mysqlUrl = process.env.MYSQL_URL?.trim();
  if (mysqlUrl && !hasNamedConnection("job-board")) {
    registerNamedConnection("job-board", "mysql", createMysqlConnection(mysqlUrl));
  }
}
`;
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
  const sidecars = layers.extras.sqliteKiosk || layers.extras.mysqlMirror;
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
import { createMetricsRoutes } from "@getstrata/bootstrap/metricsRoutes";
import { assertProductionSecrets } from "@getstrata/bootstrap/secretsGuard";
import { createWebServer } from "@getstrata/bootstrap/web/server";
import { setActiveApplicationContext } from "@getstrata/core/runtime/applicationRegistry";
import { migrate } from "../db/migrate.ts";
import { buildRoutes } from "../routes.ts";
import { loadConfig } from "./config.ts";
import { getSql } from "./database.ts";
import { starterProviders } from "./providers/index.ts";
${sidecars ? `import { bindSidecars } from "./sidecars.ts";\n` : ""}
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
  const { migrate: runMigrate = true } = options;

  if (process.env.APP_ENV === "production") {
    assertProductionSecrets();
  }

  const appConfig = loadConfig();
  getSql();
${sidecars ? "  bindSidecars();\n" : ""}
  configureModulesDirectory(join(import.meta.dir, "../modules"));
  await ensureModulesLoaded();
  const context = createAppContext();

  if (runMigrate) {
    await migrate();
  }

  const routes = mergeSpaRoutes(context.dependencies, {
    ...createMetricsRoutes(),
    ...buildRoutes(context.dependencies),
  }, {
    distDirectory: join(import.meta.dir, "../../frontend/dist"),
  });

  return { context, routes, config: appConfig };
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

function renderViewTs(): string {
  return `import { join } from "node:path";
import { resolveCsrfTokenForRequest } from "@getstrata/core/http/csrfToken";
import { EtaViewEngine, htmlResponse } from "@getstrata/core/view";

const engine = new EtaViewEngine(join(import.meta.dir, "../../views"));

export interface LayoutData {
  title: string;
  description?: string;
}

export async function renderPage(
  template: string,
  data: Record<string, unknown> & { layout: LayoutData },
  request?: Request,
): Promise<Response> {
  const csrfToken = request ? resolveCsrfTokenForRequest(request) : "";
  const html = await engine.render(template, { ...data, csrfToken });
  return htmlResponse(html);
}

export function plainText(body: string): Response {
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8" } });
}
`;
}

export {
  dialectFragments,
  renderConfigProvider,
  renderConfigTs,
  renderCreateAppTs,
  renderDatabaseTs,
  renderFreshTs,
  renderMigrateTs,
  renderPreloadTs,
  renderProvidersIndex,
  renderQueueProvider,
  renderRoutesTs,
  renderSidecarsTs,
  renderViewTs,
};
