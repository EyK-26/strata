import assert from "node:assert/strict";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { SQL } from "bun";
import { createGeneratedSecurityApp } from "../tests/helpers/generatedSecurityApp";

const fixture = await createGeneratedSecurityApp("postgres", [
  "--frontend=hybrid",
  "--auth=cookie",
  "--tenancy=rls",
  "--cache=array",
  "--queue=redis",
  "--mail=log",
  "--no-mfa",
  "--no-email-verification",
  "--no-scim",
  "--no-metrics",
  "--docker-services=postgres",
]);
const admin = new SQL({ url: fixture.migrationUrl, max: 1 });
const runtime = new URL(fixture.runtimeUrl);
const originalPassword = decodeURIComponent(runtime.password);
const ownedPassword = crypto.randomUUID().replaceAll("-", "");
runtime.password = ownedPassword;
let provisioningStarted = false;
const env = {
  ...process.env,
  APP_ENV: "local",
  DATABASE_URL: runtime.href,
  APP_DATABASE_URL: runtime.href,
  STRATA_APP_PASSWORD: ownedPassword,
  MIGRATION_DATABASE_URL: fixture.migrationUrl,
  TENANCY_DRIVER: "rls",
  AUTH_DRIVER: "cookie",
  CACHE_DRIVER: "array",
  QUEUE_DRIVER: "redis",
  MAIL_DRIVER: "log",
  FEATURE_MFA: "false",
  FEATURE_EMAIL_VERIFICATION: "false",
  FEATURE_SCIM: "false",
  FEATURE_METRICS: "false",
  FEATURE_OAUTH: "false",
  FEATURE_SAML: "false",
  CSRF_TARGET_ORIGIN: undefined,
  APP_URL: "http://localhost:3000",
  SESSION_SECRET: "owned-grant-contract-session-secret-at-least-32-characters",
};
async function run(args: string[], runtimeOnly = false) {
  const childEnv: Record<string, string | undefined> = { ...env };
  if (runtimeOnly) {
    childEnv.APP_ENV = "production";
    childEnv.APP_URL = "https://owned-grants.example.test";
    childEnv.AUTH_DEV_HEADERS = "false";
    childEnv.TENANT_DEV_HEADERS = "false";
    childEnv.OTEL_SDK_DISABLED = "true";
    for (const key of [
      "MIGRATION_DATABASE_URL",
      "MYSQL_OBSERVABILITY_ADMIN_URL",
      "MYSQL_URL",
      "RLS_TEST_DATABASE_URL",
      "POSTGRES_PASSWORD",
      "STRATA_APP_PASSWORD",
      "ADMIN_API_TOKEN",
      "MEMBER_API_TOKEN",
      "SCIM_BEARER_TOKEN",
      "METRICS_TOKEN",
      "TOKEN_HASH_PEPPER",
      "JWT_SECRET",
      "OAUTH_STATE_SECRET",
      "KMS_ENCRYPTION_KEY",
      "KMS_ENCRYPTION_KEYRING",
      "STRIPE_WEBHOOK_SECRET",
    ])
      delete childEnv[key];
  }
  const child = Bun.spawn([process.execPath, ...args], {
    cwd: fixture.app,
    env: childEnv,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 60000,
  });
  const [stdout, stderr, exit] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  assert.equal(exit, 0, `${stdout}\n${stderr}`);
  return stdout;
}
const contract = `import assert from "node:assert/strict";
import { SQL } from "bun";
import { runWithTenantDatabase } from "@getstrata/core/tenant/tenantDatabaseScope";
import { FailedJobRepository } from "@getstrata/core/queue/failedJobRepository";
import { bootstrapApp } from "./src/bootstrap/createApp.ts";
import { closeDatabase } from "./src/bootstrap/database.ts";
import { Note } from "./src/models/Note.ts";
assert.equal(process.env.MIGRATION_DATABASE_URL, undefined);
const app = await bootstrapApp({ migrate: false });
const sql = new SQL({ url: process.env.DATABASE_URL!, max: 1 });
try {
  const [identity] = await sql.unsafe<
    { current_user: string; rolsuper: boolean; rolbypassrls: boolean }[]
  >("SELECT current_user,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user");
  assert.deepEqual(identity, { current_user: "strata_app", rolsuper: false, rolbypassrls: false });
  for (const tenant of [
    { id: 1, slug: "owned-one" },
    { id: 2, slug: "owned-two" },
  ])
    await runWithTenantDatabase(tenant, async () => {
      const before = await Note.all();
      assert.equal(before.length, 1);
      assert.equal(before[0]?.toObject().tenant_id, tenant.id);
      const note = await Note.create({ body: "Žluťoučký", tenant_id: tenant.id });
      assert.equal((await Note.find(note.toObject().id))?.toObject().body, "Žluťoučký");
      await note.update({ body: "updated" });
      assert.equal((await Note.find(note.toObject().id))?.toObject().body, "updated");
      await note.delete();
      assert.equal((await Note.all()).length, 1);
    });
  const failures = new FailedJobRepository();
  const failure = await failures.create({
    job_name: "owned-grants",
    job_id: crypto.randomUUID(),
    payload: { owned: true },
    exception: "controlled fixture",
    failed_at: new Date(),
  });
  assert.deepEqual((await failures.findAll({ where: { id: failure.id } }))[0]?.payload, {
    owned: true,
  });
  assert.equal(await failures.deleteById(failure.id), true);
  const [server] = await sql.unsafe<{ version: number }[]>(
    "SELECT current_setting('server_version_num')::int AS version",
  );
  const maintenance = [
    "TRUNCATE",
    "REFERENCES",
    "TRIGGER",
    ...(server && server.version >= 170000 ? ["MAINTAIN"] : []),
  ];
  for (const table of ["notes", "acl_future_notes"]) {
    for (const privilege of maintenance) {
      const [row] = await sql.unsafe<{ allowed: boolean }[]>(
        "SELECT has_table_privilege(current_user,$1,$2) AS allowed",
        [table, privilege],
      );
      assert.equal(row?.allowed, false);
    }
    let state = "";
    try {
      await sql.begin(async (tx) => {
        await tx.unsafe("SELECT set_config('app.tenant_id','1',true)");
        await tx.unsafe("TRUNCATE TABLE " + table);
      });
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      state = String(Reflect.get(error, "errno"));
    }
    assert.equal(state, "42501");
  }
  let ddl = "";
  try {
    await sql.unsafe("CREATE TABLE owned_runtime_ddl_denied(id INT)");
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    ddl = String(Reflect.get(error, "errno"));
  }
  assert.equal(ddl, "42501");
  console.log(
    JSON.stringify({
      actualGeneratedRuntimeRole: true,
      ormTwoTenantCrud: true,
      failedJobPersistence: true,
      currentAndFutureMaintenanceDenied: true,
    }),
  );
} finally {
  await sql.close();
  await app.context.dispose();
  await closeDatabase();
}
`;
try {
  assert.equal(decodeURIComponent(runtime.username), "strata_app");
  const cli = join(fixture.app, "node_modules/.bin/strata");
  provisioningStarted = true;
  await run([cli, "migrate"]);
  await run([cli, "make:migration", "create_acl_future_notes"]);
  const directory = join(fixture.app, "src/db/migrations");
  const file = (await readdir(directory)).find((name) =>
    name.endsWith("_create_acl_future_notes.ts"),
  );
  assert.ok(file);
  await writeFile(
    join(directory, file),
    `import type { Migration } from "@getstrata/core/database/migrations/types";
import { Schema } from "@getstrata/core/database/schema";
import { enableTenantRlsSql } from "@getstrata/core/tenant/enableTenantRls";
const migration: Migration = { name:${JSON.stringify(file.slice(0, -3))}, async up(db) {
  await Schema.run(db,"pgsql",schema=>{schema.create("acl_future_notes",table=>{table.id();table.integer("tenant_id");table.string("body");});});
  await db.unsafe(enableTenantRlsSql("acl_future_notes"));
}, async down(db) { await Schema.run(db,"pgsql",schema=>{schema.drop("acl_future_notes");}); } }; export default migration;
`,
  );
  await run([cli, "migrate"]);
  await admin.unsafe(
    "INSERT INTO tenant(id,slug) VALUES(1,'owned-one'),(2,'owned-two'); INSERT INTO notes(body,tenant_id) VALUES('one',1),('two',2); INSERT INTO acl_future_notes(body,tenant_id) VALUES('later-one',1),('later-two',2)",
  );
  await writeFile(join(fixture.app, "grant-contract.ts"), contract);
  assert.match(await run(["grant-contract.ts"], true), /"currentAndFutureMaintenanceDenied":true/);
  const legacy =
    "GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO strata_app; GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO strata_app; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO strata_app; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO strata_app";
  await admin.unsafe(legacy);
  assert.equal(
    (
      await admin.unsafe<{ allowed: boolean }[]>(
        "SELECT has_table_privilege('strata_app','notes','TRUNCATE') AS allowed",
      )
    )[0]?.allowed,
    true,
  );
  await run([cli, "migrate"]); // No new migration: the supported re-provisioning path must repair ACLs.
  assert.match(await run(["grant-contract.ts"], true), /"currentAndFutureMaintenanceDenied":true/);
  const emitted = await readFile(join(fixture.app, "db/ensure-postgres-app-role.sql"), "utf8");
  assert.equal(
    emitted,
    await readFile(join(fixture.app, "docker/postgres-init/01-strata-app-role.sql"), "utf8"),
  );
  const originalName = emitted.match(
    /GRANT CONNECT ON DATABASE ([A-Za-z_][A-Za-z0-9_]*) TO strata_app;/,
  )?.[1];
  assert.ok(originalName);
  const actualName = new URL(fixture.migrationUrl).pathname.slice(1);
  assert.match(actualName, /^[A-Za-z_][A-Za-z0-9_]*$/);
  // Configure only the owned fixture's database name and rotated password. Execute every emitted
  // role/privilege statement unchanged, without installed-package patches or altered ACLs.
  assert.equal(emitted.split("PASSWORD 'dev-strata-app-change-me'").length - 1, 2);
  const configured = emitted
    .replace(
      `GRANT CONNECT ON DATABASE ${originalName} TO strata_app;`,
      `GRANT CONNECT ON DATABASE ${actualName} TO strata_app;`,
    )
    .replaceAll("PASSWORD 'dev-strata-app-change-me'", `PASSWORD '${ownedPassword}'`);
  await admin.unsafe(legacy);
  await admin.unsafe(configured);
  assert.match(await run(["grant-contract.ts"], true), /"currentAndFutureMaintenanceDenied":true/);
  await run(["run", "check"]);
  console.log(
    JSON.stringify({
      installedPostgresRuntimeGrants: true,
      fresh: true,
      repairedByCli: true,
      emittedInitAndRepeatableSql: true,
      noRuntimeAdminCredentials: true,
    }),
  );
} finally {
  try {
    // This serial acceptance case rotates the generated cluster role for production boot. Restore
    // the configured fixture credential before subsequent suites use their own disposable apps.
    if (provisioningStarted) {
      const [quoted] = await admin.unsafe<{ password: string }[]>(
        "SELECT quote_literal($1) AS password",
        [originalPassword],
      );
      assert.ok(quoted);
      await admin.unsafe(`ALTER ROLE strata_app PASSWORD ${quoted.password}`);
    }
  } finally {
    await admin.close();
    await fixture.close();
  }
}
