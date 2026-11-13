import { generatedRlsBootstrapSql } from "../../../src/core/tenant/enableTenantRls.ts";
import type { StarterFeaturePlan } from "./featurePlan.ts";
import type { DatabaseLayer } from "./types.ts";

function ensureImport(plan: StarterFeaturePlan): string {
  return plan.decisions.ensureDatabase
    ? `import { ensureAppDatabase } from "../bootstrap/ensureDatabase.ts";\n`
    : "";
}

function ensureCall(plan: StarterFeaturePlan, provision = true): string {
  return plan.decisions.ensureDatabase
    ? `  await ensureAppDatabase({ provision: ${provision} });\n`
    : "";
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

function starterSchemaStatements(plan: StarterFeaturePlan): string[] {
  const layers = plan.layers;
  const d = dialectFragments(layers.database);
  const statements: string[] = [];
  const tenancyOn = plan.decisions.tenantTable;
  const mfaOn = plan.decisions.mfa;
  const payloadType = layers.database === "postgres" ? "JSONB NOT NULL" : `${d.text} NOT NULL`;

  statements.push(`CREATE TABLE IF NOT EXISTS failed_job (
    id ${d.id},
    job_name ${d.keyText} NOT NULL,
    job_id ${d.text},
    payload ${payloadType},
    exception ${d.text} NOT NULL,
    failed_at ${d.timestamp}
  )`);

  if (plan.decisions.schemaTenants) {
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

  if (plan.decisions.users) {
    const tenantColumn = plan.decisions.schemaTenants
      ? "\n    tenant_id INTEGER NOT NULL DEFAULT 1,"
      : "";
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

  if (plan.decisions.cookie) {
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

  if (plan.decisions.token) {
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

  const rlsOn = plan.decisions.rls;
  if (rlsOn) {
    const rlsTables = plan.decisions.users ? ["notes", "users"] : ["notes"];
    const userOwnedTables: string[] = [];
    if (plan.decisions.users) {
      userOwnedTables.push("auth_one_time_tokens");
    }
    if (plan.decisions.cookie) {
      userOwnedTables.push("sessions");
    }
    if (plan.decisions.token) {
      userOwnedTables.push("api_tokens");
    }
    statements.push(generatedRlsBootstrapSql(rlsTables, userOwnedTables).trim());
  }

  return statements;
}

function renderStarterSchemaMigration(plan: StarterFeaturePlan): string {
  const layers = plan.layers;
  const statements = starterSchemaStatements(plan);
  const cascade = layers.database === "sqlite" ? "" : " CASCADE";
  const upCalls = statements
    .map((sql) => `    await db.unsafe(${JSON.stringify(sql)});`)
    .join("\n");
  const downCalls = dropTables(plan)
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

function renderMigrationRuntimeTs(plan: StarterFeaturePlan): string {
  const layers = plan.layers;
  const driver = plan.decisions.sqlDriver;
  const imports =
    layers.database === "postgres"
      ? `import { grantPostgresAppRolePrivileges, openPostgresAdminConnection, postgresDatabaseNameFromUrl } from "@getstrata/core/tenant/enableTenantRls";`
      : layers.database === "mysql"
        ? `import { createMysqlConnection } from "@getstrata/core/database/mysqlConnection";`
        : `import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createSqliteConnection } from "@getstrata/core/database/sqliteConnection";`;
  const opening =
    layers.database === "postgres"
      ? `const connection = await openPostgresAdminConnection({runtimeUrl: options.url, migrationUrl: process.env.MIGRATION_DATABASE_URL});`
      : layers.database === "mysql"
        ? `const connection = createMysqlConnection(process.env.MIGRATION_DATABASE_URL?.trim() || options.url);`
        : `if (options.filename !== ":memory:") mkdirSync(dirname(options.filename), { recursive: true });
  const connection = createSqliteConnection(options.filename);`;
  const grantOption =
    layers.database === "postgres"
      ? `,
  controls: { grantRuntimePrivileges?: boolean } = {}`
      : "";
  const grants =
    layers.database === "postgres"
      ? `
    if (controls.grantRuntimePrivileges !== false) await grantPostgresAppRolePrivileges(connection, {database: postgresDatabaseNameFromUrl(options.url)});`
      : "";
  return `import { join } from "node:path";
import { loadMigrationsFromDirectory } from "@getstrata/core/database/migrations";
import type { MigrationDatabase } from "@getstrata/core/database/migrations/types";
import { runWithSqlDialect } from "@getstrata/core/database/dialect";
${imports}
import { databaseOptions } from "../bootstrap/database.ts";

const MIGRATIONS_DIRECTORY = join(import.meta.dir, "migrations");

export async function loadStarterMigrations() {
  return loadMigrationsFromDirectory(MIGRATIONS_DIRECTORY);
}

/** Schema commands own this connection; it never becomes the runtime pool. */
export async function withMigrationDatabase<T>(
  fn: (db: MigrationDatabase) => Promise<T>${grantOption},
): Promise<T> {
  const options = databaseOptions();
  if (options.driver !== "${driver}") throw new Error("Unexpected migration database driver");
  ${opening}
  try {
    const result = await runWithSqlDialect("${driver}", () => fn(connection));${grants}
    return result;
  } finally {
    await connection.close?.();
  }
}
`;
}

function renderMigrateTs(plan: StarterFeaturePlan): string {
  const tenancyOn = plan.decisions.tenantTable;
  const usersOn = plan.decisions.users;
  const verifyOn = plan.decisions.emailVerification;
  const rlsOn = plan.decisions.rls;
  const imports = usersOn
    ? `import { hashPassword } from "@getstrata/core/auth/password";
import { User, UserRepository } from "../models/User.ts";
`
    : "";
  const tenant = plan.decisions.schemaTenants
    ? `
    const [tenant] = await selected.execute<{count:string|number}>({text:"SELECT COUNT(*) AS count FROM tenant",params:[]});
    if (Number(tenant?.count ?? 0) === 0) await selected.execute({text:\`INSERT INTO tenant (slug) VALUES (\${selected.dialect.placeholder(1)})\`,params:["default"]});`
    : "";
  const users = usersOn
    ? `
    const users = selected.model(User);
    if ((await users.query().value("id")) === null) {
      const password = await hashPassword("StrataDemo!ChangeMe");
      await users.create({name:"Demo User",email:"demo@example.com",password,is_admin:false${verifyOn ? ",email_verified_at:selected.dialect.timestampValue(new Date())" : ""}});
      await users.create({name:"Admin User",email:"admin@example.test",password,is_admin:true${verifyOn ? ",email_verified_at:selected.dialect.timestampValue(new Date())" : ""}});
    }`
    : "";
  const run = rlsOn
    ? `policy.run(database, {kind:"bypass"}, writeSeed)`
    : `database.transaction(writeSeed)`;
  return `${imports}${ensureImport(plan)}import { createApplication } from "@getstrata/core/runtime/application";
import { createDatabaseBindings } from "@getstrata/core/database/bindings";
import type { DatabaseSession, TransactionSession } from "@getstrata/core/database/session";
import { createPersistenceInvocation } from "@getstrata/bootstrap/persistenceInvocation";
import { migrateDatabase } from "@getstrata/core/database/migrations";
import { isProductionEnv } from "@getstrata/core/runtime/appEnv";
import { databaseOptions } from "../bootstrap/database.ts";
import { Note, NoteRepository } from "../models/Note.ts";
import { loadStarterMigrations, withMigrationDatabase } from "./migrationRuntime.ts";

/** An explicit development-only command owns its own canonical Application. */
export async function seed() {
  if (isProductionEnv()) throw new Error("Demo seeding is disabled in production and staging.");
${ensureCall(plan)}  const connection = databaseOptions();
  const application = createApplication({providers:[],services:createDatabaseBindings({default:"main",connections:{main:connection},repositories:[NoteRepository${usersOn ? ",UserRepository" : ""}],models:[Note${usersOn ? ",User" : ""}]})});
  await application.start();
  try {
    const invoke = createPersistenceInvocation(application, "main");
    await invoke({kind:"command",actor:{kind:"system",policy:"starter-demo-seed"}}, ({database${rlsOn ? ",policy" : ""}}) => {
      const writeSeed = async (selected: DatabaseSession | TransactionSession) => {${tenant}
        const notes = selected.model(Note);
        if ((await notes.query().value("id")) === null) await notes.create({body:"Welcome to Strata!"${tenancyOn ? ",tenant_id:1" : ""}});${users}
      };
      return ${run};
    });
  } finally {
    await application.stop();
  }
}

export async function migrate() {
${ensureCall(plan)}  await withMigrationDatabase(async (db) => {
    await migrateDatabase(db, await loadStarterMigrations());
  });
}

if (import.meta.main) {
  await migrate();
  console.log("Database migrated.");
}
`;
}

function dropTables(plan: StarterFeaturePlan): string[] {
  const ordered: string[] = ["failed_job"];
  if (plan.decisions.token) {
    ordered.push("api_tokens");
  }
  if (plan.decisions.cookie) {
    ordered.push("sessions");
    ordered.push("auth_saml_assertions");
  }
  if (plan.decisions.users) {
    ordered.push("auth_one_time_tokens");
    ordered.push("users");
  }
  ordered.push("notes");
  if (plan.decisions.schemaTenants) {
    ordered.push("tenant");
  }
  return ordered;
}

function renderFreshTs(plan: StarterFeaturePlan): string {
  return `${ensureImport(plan)}import { isProductionEnv } from "@getstrata/core/runtime/appEnv";
import { freshDatabase } from "@getstrata/core/database/migrations";
import { loadStarterMigrations, withMigrationDatabase } from "./migrationRuntime.ts";

export async function fresh() {
  if (isProductionEnv()) throw new Error("migrate:fresh is only available in development/test environments.");
${ensureCall(plan)}  await withMigrationDatabase(async (db) => {
    await freshDatabase(db, await loadStarterMigrations(), { destructive: true });
  });
}

if (import.meta.main) {
  await fresh();
  console.log("Database reset and migrated.");
  process.exit(0);
}
`;
}

function renderSeedTs(): string {
  return `import { seed } from "./migrate.ts";

export { seed };

if (import.meta.main) {
  await seed();
  console.log("Demo database seeded.");
}
`;
}

function renderStatusTs(plan: StarterFeaturePlan): string {
  const layers = plan.layers;
  return `${ensureImport(plan)}import { getMigrationStatus } from "@getstrata/core/database/migrations";
import { loadStarterMigrations, withMigrationDatabase } from "./migrationRuntime.ts";

export async function status() {
${ensureCall(plan, false)}  const rows = await withMigrationDatabase(async (db) => {
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

function renderRollbackTs(plan: StarterFeaturePlan): string {
  return `${ensureImport(plan)}import { rollbackDatabase } from "@getstrata/core/database/migrations";
import { loadStarterMigrations, withMigrationDatabase } from "./migrationRuntime.ts";

export async function rollback() {
${ensureCall(plan, false)}  const rolledBack = await withMigrationDatabase(async (db) => {
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

function renderAccountStateMigration(plan: StarterFeaturePlan): string {
  const driver = plan.decisions.sqlDriver;
  return `import { createAccountStateMigration } from "@getstrata/core/auth/accountStateMigration";

export default createAccountStateMigration("0006_account_state", "${driver}", { sessions: ${plan.decisions.cookie} });
`;
}

function renderOutboxMigration(plan: StarterFeaturePlan): string {
  const driver = plan.decisions.sqlDriver;
  const rls = plan.decisions.rls;
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
