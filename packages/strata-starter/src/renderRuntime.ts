import { generatedRlsBootstrapSql } from "../../../src/core/tenant/enableTenantRls.ts";
import { defaultDatabaseUrl, defaultMigrationDatabaseUrl } from "./renderEnv.ts";
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
    plan ${d.defaultText} NOT NULL DEFAULT 'free',
    region ${d.defaultText} NOT NULL DEFAULT 'eu'
  )`);
  }

  const notesTenantColumn = tenancyOn ? `\n    tenant_id INTEGER NOT NULL DEFAULT 1,` : "";
  statements.push(`CREATE TABLE IF NOT EXISTS notes (
    id ${d.id},
    body ${d.text} NOT NULL,${notesTenantColumn}
    created_at ${d.timestamp}
  )`);

  if (authNeedsUsers(layers.auth)) {
    const tenantColumn =
      tenancyOn || layers.extras.scim ? "\n    tenant_id INTEGER NOT NULL DEFAULT 1," : "";
    const mfaColumns = mfaOn
      ? `\n    mfa_secret ${d.text},\n    mfa_enabled ${d.bool},\n    mfa_recovery_codes ${d.text},`
      : "";
    statements.push(`CREATE TABLE IF NOT EXISTS users (
    id ${d.id},
    name ${d.text} NOT NULL,
    email ${d.keyText} NOT NULL UNIQUE,
    password ${d.text} NOT NULL,
    is_admin ${d.bool},${tenantColumn}${mfaColumns}
    session_valid_after ${d.timestampNull},
    email_verified_at ${d.timestampNull},
    created_at ${d.timestamp}
  )`);
    statements.push(`CREATE TABLE IF NOT EXISTS auth_one_time_tokens (
    id ${d.id},
    purpose ${d.keyText} NOT NULL,
    user_id INTEGER NOT NULL,
    token_hash ${d.keyText} NOT NULL UNIQUE,
    expires_at ${d.timestamp},
    consumed_at ${d.timestampNull}
  )`);
  }

  if (authUsesCookie(layers.auth)) {
    statements.push(`CREATE TABLE IF NOT EXISTS sessions (
    id ${d.keyText} PRIMARY KEY,
    user_id INTEGER NOT NULL,
    expires_at ${d.timestamp},
    user_agent ${d.text},
    ip_address ${d.text},
    last_active_at ${d.timestamp},
    created_at ${d.timestamp}
  )`);
    if (layers.database === "postgres") {
      statements.push(
        "ALTER TABLE sessions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()",
      );
    }
    statements.push(`CREATE TABLE IF NOT EXISTS auth_saml_assertions (
    assertion_id ${d.keyText} PRIMARY KEY,
    consumed_at ${d.timestamp}
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

  const rlsOn = layers.tenancy === "rls" && layers.database === "postgres";
  if (rlsOn) {
    const rlsTables = authNeedsUsers(layers.auth) ? ["notes", "users"] : ["notes"];
    const userOwnedTables: string[] = [];
    if (authNeedsUsers(layers.auth)) {
      userOwnedTables.push("auth_one_time_tokens");
    }
    if (authUsesCookie(layers.auth)) {
      userOwnedTables.push("sessions");
    }
    if (authUsesToken(layers.auth)) {
      userOwnedTables.push("api_tokens");
    }
    statements.push(generatedRlsBootstrapSql(rlsTables, userOwnedTables).trim());
  }

  const list = statements.map((sql) => `  \`${sql.replace(/`/g, "\\`")}\`,`).join("\n");

  const ph = layers.database === "postgres";
  const verifyOn = layers.extras.emailVerification && authNeedsUsers(layers.auth);
  const verifiedNow = nowTimestampLiteral(layers.database);

  const seedTenant = tenancyOn
    ? `
  const [{ count: tenantCount }] = await sql.unsafe<{ count: string | number }>(
    "SELECT COUNT(*) AS count FROM tenant",
  );
  if (Number(tenantCount) === 0) {
    await sql.unsafe(
      "INSERT INTO tenant (slug, plan, region) VALUES (${ph ? "$1, $2, $3" : "?, ?, ?"})",
      ["default", "free", "eu"],
    );
  }`
    : "";

  const seedUsers = authNeedsUsers(layers.auth)
    ? `
  if ((await User.query().value("id")) === null) {
    const password = await hashPassword("StrataDemo!ChangeMe");
    await User.create({
      name: "Demo User",
      email: "demo@example.com",
      password,
      is_admin: false,${verifyOn ? `\n      email_verified_at: ${verifiedNow},` : ""}
    });
    await User.create({
      name: "Admin User",
      email: "admin@example.test",
      password,
      is_admin: true,${verifyOn ? `\n      email_verified_at: ${verifiedNow},` : ""}
    });
  }`
    : "";

  const hashImport = authNeedsUsers(layers.auth)
    ? `import { hashPassword } from "@getstrata/core/auth/password";\n`
    : "";

  const rlsBypassImport =
    layers.tenancy === "rls" && layers.database === "postgres"
      ? `import { runWithMigrationBypass } from "@getstrata/core/tenant/databaseTenantContext";\n`
      : "";
  const postgresRoleImport =
    layers.database === "postgres"
      ? `import { grantPostgresAppRolePrivileges, openPostgresAdminConnection, postgresDatabaseNameFromUrl } from "@getstrata/core/tenant/enableTenantRls";\n`
      : "";
  const bindSql =
    seedTenant || (layers.tenancy === "rls" && layers.database === "postgres")
      ? "  const sql = getSql();\n"
      : "";
  const seedOpen =
    layers.tenancy === "rls" && layers.database === "postgres"
      ? "  await runWithMigrationBypass(async () => {\n"
      : "";
  const seedClose = layers.tenancy === "rls" && layers.database === "postgres" ? "\n  });" : "";
  const noteCreate = tenancyOn
    ? `await Note.create({ body: "Welcome to Strata!", tenant_id: 1 });`
    : `await Note.create({ body: "Welcome to Strata!" });`;

  const userImport = authNeedsUsers(layers.auth)
    ? `import { User } from "../models/User.ts";\n`
    : "";
  const needsSqlClient =
    layers.database !== "postgres" ||
    Boolean(seedTenant) ||
    (layers.tenancy === "rls" && layers.database === "postgres");
  const databaseImport = needsSqlClient
    ? `import { closeDatabase, getSql } from "../bootstrap/database.ts";\n`
    : `import { closeDatabase } from "../bootstrap/database.ts";\n`;

  return `${hashImport}${rlsBypassImport}${postgresRoleImport}${ensureImport(layers)}${databaseImport}import { Note } from "../models/Note.ts";
${userImport}
const migrations = [
${list}
];

export async function seed() {
${ensureCall(layers)}${bindSql}${seedOpen}${seedTenant}
  if ((await Note.query().value("id")) === null) {
    ${noteCreate}
  }${seedUsers}${seedClose}
}

export async function migrate() {
${ensureCall(layers)}${
  layers.database === "postgres"
    ? `  const runtimeUrl = process.env.DATABASE_URL ?? "";
  const admin = await openPostgresAdminConnection({
    runtimeUrl,
    migrationUrl: process.env.MIGRATION_DATABASE_URL,
  });
  try {
    for (const statement of migrations) {
      await admin.unsafe(statement);
    }
    await grantPostgresAppRolePrivileges(admin, {
      database: postgresDatabaseNameFromUrl(runtimeUrl),
    });
  } finally {
    await admin.close?.();
  }
`
    : `  const sql = getSql();
  for (const statement of migrations) {
    await sql.unsafe(statement);
  }
`
}  await seed();
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

function renderNoteModel(layers: StarterLayers): string {
  const tenancyOn = usesTenantTable(layers.tenancy);
  const tenantField = tenancyOn
    ? `
  tenant_id: number;`
    : "";
  const tenantColumn = tenancyOn ? ', "tenant_id"' : "";
  const fillable = tenancyOn ? '["body", "tenant_id"]' : '["body"]';
  return `import { BaseRepository } from "@getstrata/core/database/baseRepository";
import { Model, registerModelRepository } from "@getstrata/core/database/model";
import { defineTable } from "@getstrata/core/database/table";

interface NoteRecord {
  id: number;
  body: string;${tenantField}
  created_at: Date | string;
}

const notesTable = defineTable<NoteRecord, "id">({
  name: "notes",
  primaryKey: "id",
  columns: ["id", "body"${tenantColumn}, "created_at"],
  defaultOrderBy: { column: "id", direction: "ASC" },
});

class NoteRepository extends BaseRepository<NoteRecord, "id"> {
  constructor() {
    super(notesTable);
  }
}

class Note extends Model<NoteRecord, "id"> {
  static $fillable = ${fillable} as const;
  // created_at uses the table default. Sending a JS Date from $timestamps
  // is rejected by SQLite bindings.
  static $timestamps = false;
}

registerModelRepository(Note, new NoteRepository());

export type { NoteRecord };
export { Note };
`;
}

function renderUserModel(layers: StarterLayers): string {
  const tenancyOn = usesTenantTable(layers.tenancy) || layers.extras.scim;
  const mfaOn = Boolean(layers.extras.mfa);
  const tenantField = tenancyOn
    ? `
  tenant_id: number;`
    : "";
  const mfaFields = mfaOn
    ? `
  mfa_secret: string | null;
  mfa_enabled: number | boolean;
  mfa_recovery_codes: string | null;`
    : "";
  const columns = ["id", "name", "email", "password", "is_admin"];
  if (tenancyOn) {
    columns.push("tenant_id");
  }
  if (mfaOn) {
    columns.push("mfa_secret", "mfa_enabled", "mfa_recovery_codes");
  }
  columns.push("session_valid_after", "email_verified_at", "created_at");
  const fillable = ["name", "email", "password", "is_admin"];
  if (tenancyOn) {
    fillable.push("tenant_id");
  }
  if (mfaOn) {
    fillable.push("mfa_secret", "mfa_enabled", "mfa_recovery_codes");
  }
  fillable.push("session_valid_after", "email_verified_at");
  const hidden = ["password"];
  if (mfaOn) {
    hidden.push("mfa_secret", "mfa_recovery_codes");
  }
  const fillableLiteral = `[${fillable.map((column) => `"${column}"`).join(", ")}]`;
  const hiddenLiteral = `[${hidden.map((column) => `"${column}"`).join(", ")}]`;
  const columnsLiteral = columns.map((column) => `"${column}"`).join(", ");
  return `import { BaseRepository } from "@getstrata/core/database/baseRepository";
import { Model, registerModelRepository } from "@getstrata/core/database/model";
import { defineTable } from "@getstrata/core/database/table";

interface UserRecord {
  id: number;
  name: string;
  email: string;
  password: string;
  is_admin: number | boolean;${tenantField}${mfaFields}
  session_valid_after: Date | string | null;
  email_verified_at: Date | string | null;
  created_at: Date | string;
}

const usersTable = defineTable<UserRecord, "id">({
  name: "users",
  primaryKey: "id",
  columns: [${columnsLiteral}],
  defaultOrderBy: { column: "id", direction: "ASC" },
});

class UserRepository extends BaseRepository<UserRecord, "id"> {
  constructor() {
    super(usersTable);
  }
}

class User extends Model<UserRecord, "id"> {
  static $fillable = ${fillableLiteral} as const;
  static $hidden = ${hiddenLiteral} as const;
  // created_at uses the table default. Sending a JS Date from $timestamps
  // is rejected by SQLite bindings.
  static $timestamps = false;
}

registerModelRepository(User, new UserRepository());

export type { UserRecord };
export { User };
`;
}

function renderApiTokenModel(): string {
  return `import { BaseRepository } from "@getstrata/core/database/baseRepository";
import { Model, registerModelRepository } from "@getstrata/core/database/model";
import { defineTable } from "@getstrata/core/database/table";

interface ApiTokenRecord {
  id: number;
  user_id: number;
  name: string;
  token_hash: string;
  abilities: string;
  expires_at: Date | string | null;
  last_used_at: Date | string | null;
  created_at: Date | string;
}

const apiTokensTable = defineTable<ApiTokenRecord, "id">({
  name: "api_tokens",
  primaryKey: "id",
  columns: ["id", "user_id", "name", "token_hash", "abilities", "expires_at", "last_used_at", "created_at"],
  defaultOrderBy: { column: "id", direction: "ASC" },
});

class ApiTokenRepository extends BaseRepository<ApiTokenRecord, "id"> {
  constructor() {
    super(apiTokensTable);
  }
}

class ApiToken extends Model<ApiTokenRecord, "id"> {
  static $fillable = ["user_id", "name", "token_hash", "abilities", "expires_at", "last_used_at"] as const;
  // created_at uses the table default. Sending a JS Date from $timestamps
  // is rejected by SQLite bindings.
  static $timestamps = false;
}

registerModelRepository(ApiToken, new ApiTokenRepository());

export type { ApiTokenRecord };
export { ApiToken };
`;
}

function renderAuthOneTimeTokenModel(): string {
  return `import { BaseRepository } from "@getstrata/core/database/baseRepository";
import { Model, registerModelRepository } from "@getstrata/core/database/model";
import { defineTable } from "@getstrata/core/database/table";

interface AuthOneTimeTokenRecord {
  id: number;
  purpose: string;
  user_id: number;
  token_hash: string;
  expires_at: Date | string;
  consumed_at: Date | string | null;
}

const authOneTimeTokensTable = defineTable<AuthOneTimeTokenRecord, "id">({
  name: "auth_one_time_tokens",
  primaryKey: "id",
  columns: ["id", "purpose", "user_id", "token_hash", "expires_at", "consumed_at"],
  defaultOrderBy: { column: "id", direction: "ASC" },
});

class AuthOneTimeTokenRepository extends BaseRepository<AuthOneTimeTokenRecord, "id"> {
  constructor() {
    super(authOneTimeTokensTable);
  }
}

class AuthOneTimeToken extends Model<AuthOneTimeTokenRecord, "id"> {
  static $fillable = ["purpose", "user_id", "token_hash", "expires_at", "consumed_at"] as const;
  static $timestamps = false;
}

registerModelRepository(AuthOneTimeToken, new AuthOneTimeTokenRepository());

export type { AuthOneTimeTokenRecord };
export { AuthOneTimeToken };
`;
}

function dropTables(layers: StarterLayers): string[] {
  const ordered: string[] = [];
  if (authUsesToken(layers.auth)) {
    ordered.push("api_tokens");
  }
  if (authUsesCookie(layers.auth)) {
    ordered.push("sessions");
    ordered.push("auth_saml_assertions");
  }
  if (authNeedsUsers(layers.auth)) {
    ordered.push("auth_one_time_tokens");
    ordered.push("users");
  }
  ordered.push("notes");
  if (usesTenantTable(layers.tenancy)) {
    ordered.push("tenant");
  }
  return ordered;
}

function renderPostgresAdminDropCall(): string {
  return `  await dropPostgresTablesAsAdmin(tables, {
    runtimeUrl: process.env.DATABASE_URL ?? "",
    migrationUrl: process.env.MIGRATION_DATABASE_URL,
  });
`;
}

function renderFreshTs(layers: StarterLayers): string {
  const tables = dropTables(layers);
  const cascade = layers.database === "sqlite" ? "" : " CASCADE";
  const imports =
    layers.database === "postgres"
      ? `import { dropPostgresTablesAsAdmin } from "@getstrata/core/tenant/enableTenantRls";
${ensureImport(layers)}import { closeDatabase } from "../bootstrap/database.ts";
import { migrate } from "./migrate.ts";`
      : `${ensureImport(layers)}import { closeDatabase, getSql } from "../bootstrap/database.ts";
import { migrate } from "./migrate.ts";`;
  const dropBody =
    layers.database === "postgres"
      ? `${renderPostgresAdminDropCall()}  await migrate();`
      : `  const sql = getSql();
  for (const table of tables) {
    await sql.unsafe(\`DROP TABLE IF EXISTS \${table}${cascade}\`);
  }
  await migrate();`;
  return `${imports}

const tables = ${JSON.stringify(tables)};

export async function fresh() {
${ensureCall(layers)}${dropBody}
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
  const imports =
    layers.database === "postgres"
      ? `import { dropPostgresTablesAsAdmin } from "@getstrata/core/tenant/enableTenantRls";
${ensureImport(layers)}`
      : `${ensureImport(layers)}import { getSql } from "../bootstrap/database.ts";`;
  const dropBody =
    layers.database === "postgres"
      ? `${renderPostgresAdminDropCall()}  for (const table of tables) {
    console.log(\`dropped \${table}\`);
  }`
      : `  const sql = getSql();
  for (const table of tables) {
    await sql.unsafe(\`DROP TABLE IF EXISTS \${table}${cascade}\`);
    console.log(\`dropped \${table}\`);
  }`;
  return `${imports}

const tables = ${JSON.stringify(tables)};

export async function rollback() {
${ensureCall(layers)}${dropBody}
}

if (import.meta.main) {
  await rollback();
  console.log("Rolled back starter tables.");
  process.exit(0);
}
`;
}

function renderPreloadTs(layers: StarterLayers, projectName: string): string {
  const fallback = defaultDatabaseUrl(layers, projectName);
  const migrationFallback = defaultMigrationDatabaseUrl(layers, projectName);
  const migrationLine = migrationFallback
    ? `process.env.MIGRATION_DATABASE_URL ??= ${JSON.stringify(migrationFallback)};\n`
    : "";

  return `import { join } from "node:path";
import { configureModulesDirectory } from "@getstrata/bootstrap/discoverModules";

process.env.DATABASE_URL ??= ${JSON.stringify(fallback)};
${migrationLine}process.env.FRONTEND_MODE ??= ${JSON.stringify(layers.frontend)};
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
  return `import { registerDefaultJobs } from "@getstrata/bootstrap/queue/defaultJobs";
import type { ServiceProvider } from "@getstrata/core/contracts/di";
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
    container.set(
      CORE_QUEUE_TOKEN,
      createAppQueue(driver, process.env.REDIS_URL, failedJobs, registerDefaultJobs),
    );
  },
};

export default queueProvider;
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
  return process.env.DATABASE_URL?.trim() || DEFAULT_DATABASE_URL;
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

const DEFAULT_DATABASE_URL = ${JSON.stringify(fallback)};

${resolveUrl}${safeName}
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

  return `import {
  ensurePostgresDatabaseAndAppRole,
  POSTGRES_APP_ROLE_PASSWORD,
} from "@getstrata/core/tenant/enableTenantRls";

const DEFAULT_DATABASE_URL = ${JSON.stringify(fallback)};

${resolveUrl}
export async function ensureAppDatabase(): Promise<string> {
  const url = resolveAppDatabaseUrl();
  await ensurePostgresDatabaseAndAppRole({
    runtimeUrl: url,
    migrationUrl: process.env.MIGRATION_DATABASE_URL,
    password: process.env.STRATA_APP_PASSWORD ?? POSTGRES_APP_ROLE_PASSWORD,
  });
  process.env.DATABASE_URL = url;
  return url;
}
`;
}

function renderSidecarsTs(_layers: StarterLayers): string | null {
  return null;
}

function renderPolicyProvider(): string {
  return `import { CORE_POLICY_GATE_TOKEN } from "@getstrata/bootstrap/config";
import { PolicyGate } from "@getstrata/core/auth/policy";
import type { ServiceProvider } from "@getstrata/core/contracts/di";

const policyProvider: ServiceProvider = {
  name: "core.policy",
  register({ container }) {
    container.set(CORE_POLICY_GATE_TOKEN, new PolicyGate());
  },
};

export default policyProvider;
`;
}

function renderProvidersIndex(): string {
  return `import { discoverListeners } from "@getstrata/bootstrap/discoverListeners";
import { registerInvalidateCacheOnModelWriteListeners } from "@getstrata/bootstrap/listeners/invalidateCacheOnModelWrite";
import type { ServiceProvider } from "@getstrata/core/contracts/di";
import authProvider from "./auth.ts";
import cacheProvider from "./cache.ts";
import configProvider from "./config.ts";
import policyProvider from "./policy.ts";
import queueProvider from "./queue.ts";
import storageProvider from "./storage.ts";

const registeredListenerGroups = new Set<string>();

function registerListenerGroup(name: string, register: () => void): void {
  if (registeredListenerGroups.has(name)) {
    return;
  }

  registeredListenerGroups.add(name);
  register();
}

const listenersProvider: ServiceProvider = {
  name: "starter.listeners",
  boot() {
    registerListenerGroup("cache.invalidate-on-model-write", () => {
      registerInvalidateCacheOnModelWriteListeners();
    });

    for (const registerListener of discoverListeners()) {
      registerListener();
    }
  },
};

const starterProviders: ServiceProvider[] = [
  configProvider,
  cacheProvider,
  storageProvider,
  queueProvider,
  authProvider,
  policyProvider,
  listenersProvider,
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
  discoverModules,
  ensureModulesLoaded,
} from "@getstrata/bootstrap/discoverModules";
import { createHealthRoutes } from "@getstrata/bootstrap/health";
${metricsImport}import { assertProductionSecrets, assertRlsLiveDatabaseRole } from "@getstrata/bootstrap/secretsGuard";
import { createWebServer } from "@getstrata/bootstrap/web/server";
import { setActiveApplicationContext } from "@getstrata/core/runtime/applicationRegistry";
import { isProductionEnv } from "@getstrata/core/runtime/appEnv";
import { isRlsTenancy } from "@getstrata/core/tenant/tenancyConfig";
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

  const moduleProviders = discoverModules().flatMap((module) => module.providers ?? []);
  runProviderPhase(moduleProviders, "register", context);
  runProviderPhase(moduleProviders, "boot", context);

  assertAppDependenciesComplete(dependencies);

  const appContext = { container, config, dependencies: dependencies as AppDependencies };
  setActiveApplicationContext(appContext as never);
  return appContext;
}

export async function bootstrapApp(options: BootstrapOptions = {}): Promise<BootstrappedApp> {
  const isProduction = isProductionEnv();
  // Dev boots migrate for convenience. Production must not mutate schema on
  // start, so run \`strata migrate\` as an explicit deploy step instead.
  const { migrate: runMigrate = !isProduction } = options;

  if (isProduction) {
    assertProductionSecrets();
  }

${needsEnsure(layers) ? "  await ensureAppDatabase();\n" : ""}  const appConfig = loadConfig();
  getSql();
  if (isRlsTenancy()) {
    await assertRlsLiveDatabaseRole();
  }
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

function renderBootstrapScheduleTs(): string {
  return `import { appSchedule } from "@getstrata/core/scheduler/schedule";

// Register cron tasks on appSchedule, then run \`strata schedule:run\`.
export { appSchedule };
`;
}

function renderCliOpenApiTs(): string {
  return `import {
  createOpenApiCheckCommand,
  createOpenApiGenerateCommand,
  createOpenApiValidateCommand,
} from "@getstrata/cli/openapi";
import { createApp } from "../../bootstrap/createApp.ts";

const bootstrapAppRoutes = () => createApp();

export const openapiGenerateCommand = createOpenApiGenerateCommand(bootstrapAppRoutes);
export const openapiValidateCommand = createOpenApiValidateCommand(bootstrapAppRoutes);
export const openapiCheckCommand = createOpenApiCheckCommand(bootstrapAppRoutes);
`;
}

function renderCliScheduleRunTs(): string {
  return `import { createScheduleRunCommand } from "@getstrata/cli/schedule";

export const scheduleRunCommand = createScheduleRunCommand(async () => {
  await import("../../bootstrap/schedule.ts");
});
`;
}

function renderCliRegisterTs(): string {
  return `import type { StrataCommandMap } from "@getstrata/cli";
import { scaffoldCommands } from "@getstrata/cli/scaffold";

const commands: StrataCommandMap = {
  ...scaffoldCommands,
  "queue:work": async () => (await import("./commands/queueWork.ts")).queueWorkCommand,
  "openapi:generate": async () => (await import("./commands/openapi.ts")).openapiGenerateCommand,
  "openapi:validate": async () => (await import("./commands/openapi.ts")).openapiValidateCommand,
  "openapi:check": async () => (await import("./commands/openapi.ts")).openapiCheckCommand,
  "schedule:run": async () => (await import("./commands/scheduleRun.ts")).scheduleRunCommand,
};

export { commands };
`;
}

function renderCliQueueWorkTs(): string {
  return `import { runQueueWorkerCommand } from "@getstrata/cli/queueWorker";
import { bootstrapApp } from "../../bootstrap/createApp.ts";
import { closeDatabase } from "../../bootstrap/database.ts";

async function queueWorkCommand(): Promise<void> {
  await runQueueWorkerCommand({
    async boot() {
      await bootstrapApp({ migrate: false });
    },
    close: closeDatabase,
  });
}

export { queueWorkCommand };
`;
}

export {
  dialectFragments,
  renderApiTokenModel,
  renderAuthOneTimeTokenModel,
  renderBootstrapScheduleTs,
  renderCliOpenApiTs,
  renderCliQueueWorkTs,
  renderCliRegisterTs,
  renderCliScheduleRunTs,
  renderConfigProvider,
  renderConfigTs,
  renderCreateAppTs,
  renderDatabaseTs,
  renderEnsureDatabaseTs,
  renderFreshTs,
  renderMigrateTs,
  renderNoteModel,
  renderPolicyProvider,
  renderPreloadTs,
  renderProvidersIndex,
  renderQueueProvider,
  renderRollbackTs,
  renderRoutesTs,
  renderSeedTs,
  renderSidecarsTs,
  renderStatusTs,
  renderUserModel,
  renderViewTs,
};
