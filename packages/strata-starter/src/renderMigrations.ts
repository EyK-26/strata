import { generatedRlsBootstrapSql } from "../../../src/core/tenant/enableTenantRls.ts";
import { needsEnsure } from "./renderDatabase.ts";
import {
  authNeedsUsers,
  authUsesCookie,
  authUsesToken,
  type DatabaseLayer,
  type StarterLayers,
  usesTenantTable,
} from "./types.ts";

function ensureImport(layers: StarterLayers): string {
  return needsEnsure(layers)
    ? `import { ensureAppDatabase } from "../bootstrap/ensureDatabase.ts";\n`
    : "";
}

function ensureCall(layers: StarterLayers, provision = true): string {
  return needsEnsure(layers) ? `  await ensureAppDatabase({ provision: ${provision} });\n` : "";
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

function starterSchemaStatements(layers: StarterLayers): string[] {
  const d = dialectFragments(layers.database);
  const statements: string[] = [];
  const tenancyOn = usesTenantTable(layers.tenancy);
  const mfaOn = layers.extras.mfa && authNeedsUsers(layers.auth);
  const payloadType = layers.database === "postgres" ? "JSONB NOT NULL" : `${d.text} NOT NULL`;

  statements.push(`CREATE TABLE IF NOT EXISTS failed_job (
    id ${d.id},
    job_name ${d.keyText} NOT NULL,
    job_id ${d.text},
    payload ${payloadType},
    exception ${d.text} NOT NULL,
    failed_at ${d.timestamp}
  )`);

  if (tenancyOn) {
    statements.push(`CREATE TABLE IF NOT EXISTS tenant (
    id ${d.id},
    slug ${d.keyText} NOT NULL UNIQUE
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

  return statements;
}

function renderStarterSchemaMigration(layers: StarterLayers): string {
  const statements = starterSchemaStatements(layers);
  const cascade = layers.database === "sqlite" ? "" : " CASCADE";
  const upCalls = statements
    .map((sql) => `    await db.unsafe(${JSON.stringify(sql)});`)
    .join("\n");
  const downCalls = dropTables(layers)
    .map((table) => `    await db.unsafe("DROP TABLE IF EXISTS ${table}${cascade}");`)
    .join("\n");

  return `import type { Migration } from "@getstrata/core/database/migrations/types";

const migration: Migration = {
  name: "0001_starter_schema",
  async up(db) {
${upCalls}
  },
  async down(db) {
${downCalls}
  },
};

export default migration;
`;
}

function renderMigrationRuntimeTs(layers: StarterLayers): string {
  if (layers.database === "postgres") {
    return `import { join } from "node:path";
import { loadMigrationsFromDirectory } from "@getstrata/core/database/migrations";
import type { MigrationDatabase } from "@getstrata/core/database/migrations/types";
import {
  grantPostgresAppRolePrivileges,
  openPostgresAdminConnection,
  postgresDatabaseNameFromUrl,
} from "@getstrata/core/tenant/enableTenantRls";

const MIGRATIONS_DIRECTORY = join(import.meta.dir, "migrations");

export async function loadStarterMigrations() {
  return loadMigrationsFromDirectory(MIGRATIONS_DIRECTORY);
}

export async function withMigrationDatabase<T>(
  fn: (db: MigrationDatabase) => Promise<T>,
  options: { grantRuntimePrivileges?: boolean } = {},
): Promise<T> {
  const runtimeUrl = process.env.DATABASE_URL ?? "";
  const admin = await openPostgresAdminConnection({
    runtimeUrl,
    migrationUrl: process.env.MIGRATION_DATABASE_URL,
  });
  try {
    const result = await fn(admin);
    if (options.grantRuntimePrivileges !== false) {
      await grantPostgresAppRolePrivileges(admin, {
        database: postgresDatabaseNameFromUrl(runtimeUrl),
      });
    }
    return result;
  } finally {
    await admin.close?.();
  }
}
`;
  }

  if (layers.database === "mysql") {
    return `import { join } from "node:path";
import { loadMigrationsFromDirectory } from "@getstrata/core/database/migrations";
import type { MigrationDatabase } from "@getstrata/core/database/migrations/types";
import { createMysqlConnection } from "@getstrata/core/database/mysqlConnection";
import { runWithDatabaseConnection } from "@getstrata/core/database/connectionContext";
import { getSql } from "../bootstrap/database.ts";

const MIGRATIONS_DIRECTORY = join(import.meta.dir, "migrations");

export async function loadStarterMigrations() {
  return loadMigrationsFromDirectory(MIGRATIONS_DIRECTORY);
}

export async function withMigrationDatabase<T>(fn: (db: MigrationDatabase) => Promise<T>): Promise<T> {
  const runtime = getSql();
  const url = process.env.MIGRATION_DATABASE_URL?.trim();
  if (!url) return fn(runtime);
  const admin = createMysqlConnection(url);
  try {
    return await runWithDatabaseConnection(admin, () => fn(admin));
  } finally {
    await admin.close();
  }
}
`;
  }

  return `import { join } from "node:path";
import { loadMigrationsFromDirectory } from "@getstrata/core/database/migrations";
import type { MigrationDatabase } from "@getstrata/core/database/migrations/types";
import { getSql } from "../bootstrap/database.ts";

const MIGRATIONS_DIRECTORY = join(import.meta.dir, "migrations");

export async function loadStarterMigrations() {
  return loadMigrationsFromDirectory(MIGRATIONS_DIRECTORY);
}

export async function withMigrationDatabase<T>(
  fn: (db: MigrationDatabase) => Promise<T>,
): Promise<T> {
  return fn(getSql());
}
`;
}

function renderMigrateTs(layers: StarterLayers): string {
  const tenancyOn = usesTenantTable(layers.tenancy);
  const ph = layers.database === "postgres";
  const verifyOn = layers.extras.emailVerification && authNeedsUsers(layers.auth);
  const verifiedNow = "sqlTimestamp()";

  const seedTenant = tenancyOn
    ? `
  const [{ count: tenantCount }] = await sql.unsafe<{ count: string | number }>(
    "SELECT COUNT(*) AS count FROM tenant",
  );
  if (Number(tenantCount) === 0) {
    await sql.unsafe(
      "INSERT INTO tenant (slug) VALUES (${ph ? "$1" : "?"})",
      ["default"],
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
  const bindSql =
    seedTenant || (layers.tenancy === "rls" && layers.database === "postgres")
      ? "  const sql = getSql();\n"
      : "  getSql();\n";
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
  const databaseImport = `import { closeDatabase, getSql } from "../bootstrap/database.ts";\n`;

  const timestampImport = verifyOn
    ? `import { sqlTimestamp } from "@getstrata/core/database/dialect";\n`
    : "";
  return `${hashImport}${timestampImport}${rlsBypassImport}${ensureImport(layers)}${databaseImport}import { migrateDatabase } from "@getstrata/core/database/migrations";
import { Note } from "../models/Note.ts";
${userImport}import { loadStarterMigrations, withMigrationDatabase } from "./migrationRuntime.ts";
import { isProductionEnv } from "@getstrata/core/runtime/appEnv";

export async function seed() {
  if (isProductionEnv()) throw new Error("Demo seeding is disabled in production and staging.");
${ensureCall(layers)}${bindSql}${seedOpen}${seedTenant}
  if ((await Note.query().value("id")) === null) {
    ${noteCreate}
  }${seedUsers}${seedClose}
}

export async function migrate() {
${ensureCall(layers)}  await withMigrationDatabase(async (db) => {
    await migrateDatabase(db, await loadStarterMigrations());
  });
}

/** The CLI calls this after migrate() so pooled drivers do not hold the process open. */
export async function close() {
  await closeDatabase();
}

if (import.meta.main) {
  await migrate();
  console.log("Database migrated.");
  await close();
  process.exit(0);
}
`;
}

function dropTables(layers: StarterLayers): string[] {
  const ordered: string[] = ["failed_job"];
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

function renderFreshTs(layers: StarterLayers): string {
  return `${ensureImport(layers)}import { isProductionEnv } from "@getstrata/core/runtime/appEnv";
import { freshDatabase } from "@getstrata/core/database/migrations";
import { closeDatabase } from "../bootstrap/database.ts";
import { loadStarterMigrations, withMigrationDatabase } from "./migrationRuntime.ts";

export async function fresh() {
  if (isProductionEnv()) throw new Error("migrate:fresh is only available in development/test environments.");
${ensureCall(layers)}  await withMigrationDatabase(async (db) => {
    await freshDatabase(db, await loadStarterMigrations(), { destructive: true });
  });
}

/** The CLI calls this after fresh() so pooled drivers do not hold the process open. */
export async function close() {
  await closeDatabase();
}

if (import.meta.main) {
  await fresh();
  console.log("Database reset and migrated.");
  await close();
  process.exit(0);
}
`;
}

function renderSeedTs(): string {
  return `import { close, seed } from "./migrate.ts";

export { seed };

if (import.meta.main) {
  try {
    await seed();
    console.log("Demo database seeded.");
  } finally {
    await close();
  }
}
`;
}

function renderStatusTs(layers: StarterLayers): string {
  return `${ensureImport(layers)}import { getMigrationStatus } from "@getstrata/core/database/migrations";
import { loadStarterMigrations, withMigrationDatabase } from "./migrationRuntime.ts";

export async function status() {
${ensureCall(layers, false)}  const rows = await withMigrationDatabase(async (db) => {
    return getMigrationStatus(db, await loadStarterMigrations());
  }${layers.database === "postgres" ? ", { grantRuntimePrivileges: false }" : ""});
  console.log("Migrations:");
  for (const row of rows) {
    const batch = row.batch == null ? "" : \` (batch \${row.batch})\`;
    console.log(\`- [\${row.status}] \${row.name}\${batch}\`);
  }
}

if (import.meta.main) {
  await status();
  process.exit(0);
}
`;
}

function renderRollbackTs(layers: StarterLayers): string {
  return `${ensureImport(layers)}import { rollbackDatabase } from "@getstrata/core/database/migrations";
import { loadStarterMigrations, withMigrationDatabase } from "./migrationRuntime.ts";

export async function rollback() {
${ensureCall(layers, false)}  const rolledBack = await withMigrationDatabase(async (db) => {
    return rollbackDatabase(db, await loadStarterMigrations(), {
      onMigration: (name) => {
        console.log(\`rolled back \${name}\`);
      },
    });
  });
  if (rolledBack === 0) {
    console.log("Nothing to roll back.");
  }
}

if (import.meta.main) {
  await rollback();
  console.log("Rolled back last migration batch.");
  process.exit(0);
}
`;
}

function renderAccountStateMigration(layers: StarterLayers): string {
  const driver = layers.database === "postgres" ? "pgsql" : layers.database;
  return `import { createAccountStateMigration } from "@getstrata/core/auth/accountStateMigration";

export default createAccountStateMigration("0006_account_state", "${driver}", { sessions: ${authUsesCookie(layers.auth)} });
`;
}

function renderOutboxMigration(layers: StarterLayers): string {
  const driver = layers.database === "postgres" ? "pgsql" : layers.database;
  const rls = layers.tenancy === "rls" && layers.database === "postgres";
  return `import { createOutboxMigration } from "@getstrata/core/events/outbox";

export default createOutboxMigration("0005_outbox", "${driver}", { rls: ${rls} });
`;
}

export {
  dialectFragments,
  renderAccountStateMigration,
  renderFreshTs,
  renderMigrateTs,
  renderMigrationRuntimeTs,
  renderOutboxMigration,
  renderRollbackTs,
  renderSeedTs,
  renderStarterSchemaMigration,
  renderStatusTs,
};
