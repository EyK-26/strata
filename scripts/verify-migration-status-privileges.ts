import assert from "node:assert/strict";
import { SQL } from "bun";
import { createGeneratedSecurityApp } from "../tests/helpers/generatedSecurityApp";

const publishedVersion = process.argv.find((arg) => arg.startsWith("--published="))?.slice(12);
const fixture = await createGeneratedSecurityApp(
  "postgres",
  [
    "--frontend=api",
    "--auth=headers",
    "--tenancy=rls",
    "--cache=array",
    "--queue=sync",
    "--mail=log",
    "--no-mfa",
    "--no-email-verification",
    "--no-scim",
    "--no-metrics",
    "--no-docker",
  ],
  { publishedVersion },
);
const admin = new SQL({ url: fixture.migrationUrl, max: 1 });
const control = new SQL({ url: process.env.MIGRATION_DATABASE_URL, max: 1 });
const readerName = `status_reader_${crypto.randomUUID().replaceAll("-", "")}`;
const readerPassword = crypto.randomUUID();
const readerUrl = new URL(fixture.migrationUrl);
readerUrl.username = readerName;
readerUrl.password = readerPassword;
const env = {
  ...process.env,
  APP_ENV: "local",
  DATABASE_URL: fixture.runtimeUrl,
  APP_DATABASE_URL: fixture.runtimeUrl,
  MIGRATION_DATABASE_URL: fixture.migrationUrl,
  DB_CONNECTION: "pgsql",
  TENANCY_DRIVER: "rls",
  AUTH_DRIVER: "headers",
  CACHE_DRIVER: "array",
  QUEUE_DRIVER: "sync",
  MAIL_DRIVER: "log",
  APP_URL: "http://127.0.0.1:3000",
  FEATURE_MFA: "false",
  FEATURE_EMAIL_VERIFICATION: "false",
  FEATURE_SCIM: "false",
  FEATURE_METRICS: "false",
};
let readerCreated = false;
async function command(args: string[], overrides: Record<string, string> = {}) {
  const p = Bun.spawn([process.execPath, ...args], {
    cwd: fixture.app,
    env: { ...env, ...overrides },
    stdout: "pipe",
    stderr: "pipe",
    timeout: 60000,
  });
  const [stdout, stderr, exit] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
    p.exited,
  ]);
  return { stdout, stderr, exit };
}
const migrate = () => command(["node_modules/@getstrata/cli/cli.ts", "migrate"]);
const status = (overrides: Record<string, string> = {}) => command(["src/db/status.ts"], overrides);
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
async function snapshot() {
  return plain({
    objects: await admin.unsafe(
      "SELECT c.relname,c.relowner::regrole::text AS owner,coalesce(c.relacl::text,'') AS acl,c.relrowsecurity,c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','S') ORDER BY c.relname",
    ),
    defaults: await admin.unsafe(
      "SELECT defaclrole::regrole::text AS owner,defaclnamespace,defaclobjtype,defaclacl::text AS acl FROM pg_default_acl ORDER BY defaclrole,defaclnamespace,defaclobjtype",
    ),
    schema: await admin.unsafe(
      "SELECT nspowner::regrole::text AS owner,coalesce(nspacl::text,'') AS acl FROM pg_namespace WHERE nspname='public'",
    ),
    roles: await admin.unsafe(
      "SELECT rolname,rolsuper,rolcreaterole,rolcreatedb,rolbypassrls,rolinherit FROM pg_roles WHERE rolname IN ('strata_app',$1) ORDER BY rolname",
      [readerName],
    ),
    policies: await admin.unsafe(
      "SELECT tablename,policyname,permissive,roles,cmd,qual,with_check FROM pg_policies WHERE schemaname='public' ORDER BY tablename,policyname",
    ),
  });
}
async function restrictRuntime() {
  await admin.unsafe(
    "REVOKE ALL ON ALL TABLES IN SCHEMA public FROM strata_app; REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM strata_app; GRANT SELECT,INSERT,UPDATE ON notes,operator_keep TO strata_app; GRANT USAGE ON SEQUENCE notes_id_seq TO strata_app; ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM strata_app; ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM strata_app",
  );
  const [row] = await admin.unsafe(
    "SELECT has_table_privilege('strata_app','notes','DELETE') AS can_delete,has_table_privilege('strata_app','notes','TRUNCATE') AS can_truncate,has_schema_privilege('strata_app','public','CREATE') AS can_create",
  );
  assert.deepEqual(plain(row), { can_delete: false, can_truncate: false, can_create: false });
}
const errors: unknown[] = [];
async function check(name: string, operation: () => Promise<void>) {
  try {
    await operation();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}:`, error);
    errors.push(error);
  }
}
try {
  assert.equal((await migrate()).exit, 0, "Explicit fixture migration failed");
  await admin.unsafe(
    "INSERT INTO tenant(slug) VALUES ('status-fixture'); INSERT INTO notes(body,tenant_id) VALUES ('Příliš žluťoučký',1); CREATE TABLE operator_keep(id INT PRIMARY KEY,body TEXT); INSERT INTO operator_keep VALUES(1,'operator-owned')",
  );
  await control.unsafe(
    `CREATE ROLE ${readerName} LOGIN PASSWORD '${readerPassword}' NOSUPERUSER NOCREATEROLE NOCREATEDB NOBYPASSRLS`,
  );
  readerCreated = true;
  const database = new URL(fixture.migrationUrl).pathname.slice(1);
  assert.match(database, /^[a-z0-9_]+$/);
  await admin.unsafe(
    `GRANT CONNECT ON DATABASE ${database} TO ${readerName};GRANT USAGE ON SCHEMA public TO ${readerName};GRANT SELECT ON framework_migrations TO ${readerName}`,
  );
  const reader = new SQL({ url: readerUrl.href, max: 1 });
  try {
    const [identity] = await reader.unsafe(
      "SELECT current_user,session_user,rolsuper,rolcreaterole,rolcreatedb,rolbypassrls,has_schema_privilege(current_user,'public','CREATE') AS can_create FROM pg_roles WHERE rolname=current_user",
    );
    assert.deepEqual(plain(identity), {
      current_user: readerName,
      session_user: readerName,
      rolsuper: false,
      rolcreaterole: false,
      rolcreatedb: false,
      rolbypassrls: false,
      can_create: false,
    });
  } finally {
    await reader.close();
  }
  const history = plain(
    await admin.unsafe("SELECT name,batch,run_on::text FROM framework_migrations ORDER BY name"),
  );
  await check(
    "owner status preserves restricted direct/default ACLs, RLS policies and history",
    async () => {
      await restrictRuntime();
      const before = await snapshot();
      const result = await status();
      assert.equal(result.exit, 0, result.stderr);
      assert.match(result.stdout, /\[up\]/);
      assert.deepEqual(await snapshot(), before);
      assert.deepEqual(
        plain(
          await admin.unsafe(
            "SELECT name,batch,run_on::text FROM framework_migrations ORDER BY name",
          ),
        ),
        history,
      );
    },
  );
  await check(
    "history reader needs SELECT but no schema CREATE or role/grant administration",
    async () => {
      await restrictRuntime();
      const before = await snapshot();
      const result = await status({ MIGRATION_DATABASE_URL: readerUrl.href });
      assert.equal(result.exit, 0, result.stderr);
      assert.match(result.stdout, /\[up\]/);
      assert.deepEqual(await snapshot(), before);
    },
  );
  await check(
    "missing history is reported without creating a replacement table or repairing privileges",
    async () => {
      await restrictRuntime();
      await admin.unsafe("ALTER TABLE framework_migrations RENAME TO owned_history_saved");
      try {
        const before = await snapshot();
        const result = await status();
        assert.notEqual(result.exit, 0, "Status silently created missing history");
        assert.match(result.stderr, /framework_migrations/);
        assert.deepEqual(await snapshot(), before);
      } finally {
        await admin.unsafe(
          "DROP TABLE IF EXISTS framework_migrations;ALTER TABLE owned_history_saved RENAME TO framework_migrations",
        );
      }
    },
  );
  await check("insufficient history access fails honestly without changing ACLs", async () => {
    await restrictRuntime();
    await admin.unsafe(`REVOKE SELECT ON framework_migrations FROM ${readerName}`);
    const before = await snapshot();
    try {
      const result = await status({ MIGRATION_DATABASE_URL: readerUrl.href });
      assert.notEqual(result.exit, 0);
      assert.match(result.stderr, /permission denied for table framework_migrations/);
      assert.deepEqual(await snapshot(), before);
    } finally {
      await admin.unsafe(`GRANT SELECT ON framework_migrations TO ${readerName}`);
    }
  });
  await check(
    "explicit migrate still repairs intended runtime grants and preserves forced RLS",
    async () => {
      await restrictRuntime();
      const result = await migrate();
      assert.equal(result.exit, 0, result.stderr);
      const [row] = await admin.unsafe(
        "SELECT has_table_privilege('strata_app','notes','DELETE') AS can_delete,has_table_privilege('strata_app','notes','TRUNCATE') AS can_truncate,has_schema_privilege('strata_app','public','CREATE') AS can_create",
      );
      assert.deepEqual(plain(row), { can_delete: true, can_truncate: false, can_create: false });
      const runtime = new SQL({ url: fixture.runtimeUrl, max: 1 });
      try {
        assert.equal((await runtime.unsafe("SELECT * FROM notes")).length, 0);
        await runtime.begin(async (sql) => {
          await sql.unsafe("SET LOCAL app.tenant_id='1'");
          assert.equal((await sql.unsafe("SELECT * FROM notes"))[0]?.body, "Příliš žluťoučký");
          await sql.unsafe("INSERT INTO notes(body,tenant_id) VALUES ('sequence-backed',1)");
        });
        assert.equal((await runtime.unsafe("SELECT * FROM notes")).length, 0);
        await assert.rejects(
          runtime.unsafe("CREATE TABLE runtime_forbidden(id INT)"),
          /permission denied/,
        );
      } finally {
        await runtime.close();
      }
    },
  );
  await check("explicit rollback retains grant repair for remaining operator tables", async () => {
    await admin.unsafe("REVOKE DELETE ON operator_keep FROM strata_app");
    const result = await command(["src/db/rollback.ts"]);
    assert.equal(result.exit, 0, result.stderr);
    const [row] = await admin.unsafe(
      "SELECT has_table_privilege('strata_app','operator_keep','DELETE') AS can_delete,has_table_privilege('strata_app','operator_keep','TRUNCATE') AS can_truncate",
    );
    assert.deepEqual(plain(row), { can_delete: true, can_truncate: false });
    assert.equal((await admin.unsafe("SELECT * FROM operator_keep"))[0]?.body, "operator-owned");
  });
} catch (error) {
  errors.push(error);
} finally {
  for (const cleanup of [
    () => admin.close(),
    () => fixture.close(),
    async () => {
      if (readerCreated) await control.unsafe(`DROP ROLE ${readerName}`);
    },
    () => control.close(),
  ]) {
    try {
      await cleanup();
    } catch (error) {
      errors.push(error);
    }
  }
}
if (errors.length) throw new AggregateError(errors, "Migration status execution/cleanup failed");
console.log(
  JSON.stringify({
    installedMigrationStatusReadOnly: true,
    ownerAndRestrictedReader: true,
    missingAndDeniedHistoryHonest: true,
    explicitMigrationAndRollbackGrantsRetained: true,
    rlsAndSequenceWritesRetained: true,
  }),
);
