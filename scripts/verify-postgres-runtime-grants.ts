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
let admin: SQL | undefined;
const runtime = new URL(fixture.runtimeUrl);
const originalPassword = decodeURIComponent(runtime.password);
const ownedPassword = crypto.randomUUID().replaceAll("-", "");
runtime.password = ownedPassword;
let provisioningStarted = false;
const env = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(([key]) =>
      ["PATH", "HOME", "TMPDIR", "USER", "SHELL", "REDIS_URL"].includes(key),
    ),
  ),
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
const failures: unknown[] = [];
let activeChild: ReturnType<typeof Bun.spawn<"ignore", "pipe", "pipe">> | undefined;
let terminationTimer: ReturnType<typeof setTimeout> | undefined;
let interrupted = false;
const interruption = new Error("Native credential verification interrupted by SIGTERM.");
function throwFailures(errors: unknown[], message: string): void {
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, message);
}
function checkInterrupted(): void {
  if (interrupted) throw interruption;
}
const terminate = () => {
  interrupted = true;
  process.exitCode = 143;
  // The body still owns cleanup. Abort and join its child before releasing the fixture.
  if (activeChild?.exitCode === null) {
    try {
      activeChild.kill("SIGTERM");
    } catch (error) {
      failures.push(error);
    }
    terminationTimer ??= setTimeout(() => {
      try {
        if (activeChild?.exitCode === null) activeChild.kill("SIGKILL");
      } catch (error) {
        failures.push(error);
      }
    }, 5000);
  }
};
process.once("SIGTERM", terminate);
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
  checkInterrupted();
  const child = Bun.spawn([process.execPath, ...args], {
    cwd: fixture.app,
    env: childEnv,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    timeout: 60000,
    killSignal: "SIGKILL",
  });
  activeChild = child;
  try {
    const results = await Promise.allSettled([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ] as const);
    const errors = results.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    const [terminal, out, err] = results;
    const output = `${out.status === "fulfilled" ? out.value : ""}${err.status === "fulfilled" ? err.value : ""}`;
    if (terminal.status === "fulfilled") {
      try {
        assert.equal(terminal.value, 0, output);
      } catch (error) {
        errors.push(error);
      }
    }
    if (interrupted) errors.push(interruption);
    throwFailures(errors, "Native credential child exit/output collection failed.");
    return output;
  } finally {
    if (terminationTimer) clearTimeout(terminationTimer);
    terminationTimer = undefined;
    activeChild = undefined;
  }
}
const contract = `import assert from "node:assert/strict";
import { SQL } from "bun";
import type { Application } from "@getstrata/core/contracts/application";
import { failedJobRepository } from "@getstrata/core/queue/failedJobRepository";
import {BaseRepository} from '@getstrata/core/database/baseRepository';
import {defineRepository} from '@getstrata/core/database/definitions';
import {defineTable} from '@getstrata/core/database/table';
import { bootstrapApp } from "./src/bootstrap/createApp.ts";
import { Note } from "./src/models/Note.ts";
for(const key of ['MIGRATION_DATABASE_URL','MYSQL_OBSERVABILITY_ADMIN_URL','MYSQL_URL','RLS_TEST_DATABASE_URL','POSTGRES_PASSWORD','STRATA_APP_PASSWORD'])assert.equal(process.env[key],undefined);
const futureNotes=defineRepository({
 name:'FixtureFutureNotes',
 table:defineTable<{id:number;tenant_id:number;body:string},'id'>({name:'acl_future_notes',primaryKey:'id',columns:['id','tenant_id','body']}),
 dependencies:[],create:binding=>new BaseRepository(binding),
});
let owner:Application|undefined;let sql:SQL|undefined;const errors:unknown[]=[];
try {
  const app = await bootstrapApp({migrate:false,mode:'command',persistence:{repositories:[futureNotes]},onConstructed:application=>{owner=application;return undefined;}});
  sql = new SQL({ url: process.env.DATABASE_URL!, max: 1 });
  const [identity] = await sql.unsafe<
    { current_user: string; rolsuper: boolean; rolbypassrls: boolean; rolcreatedb:boolean; rolcreaterole:boolean; rolinherit:boolean }[]
  >("SELECT current_user,rolsuper,rolbypassrls,rolcreatedb,rolcreaterole,rolinherit FROM pg_roles WHERE rolname=current_user");
  assert.deepEqual(identity, { current_user: "strata_app", rolsuper: false, rolbypassrls: false, rolcreatedb:false,rolcreaterole:false,rolinherit:false });
  for (const tenant of [
    { id: 1, slug: "owned-one" },
    { id: 2, slug: "owned-two" },
  ])
    await app.invoke({kind:'command',tenant,actor:{kind:'system',policy:'fixture.postgres-grants'}},({database,policy})=>policy.run(database,{kind:'tenant',tenantId:tenant.id},async(selected)=>{
      const notes=selected.model(Note);
      const before = await notes.all();
      assert.equal(before.length, 1);
      assert.equal(before[0]?.toObject().tenant_id, tenant.id);
      const note = await notes.create({ body: "Žluťoučký", tenant_id: tenant.id });
      assert.equal((await notes.find(note.toObject().id))?.toObject().body, "Žluťoučký");
      await note.update({ body: "updated" });
      assert.equal((await notes.find(note.toObject().id))?.toObject().body, "updated");
      await note.delete();
      assert.equal((await notes.all()).length, 1);
    }));
  await app.invoke({kind:'command',actor:{kind:'system',policy:'fixture.postgres-failed-job'}},async({database})=>{
  const failures = database.repository(failedJobRepository);
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
  });
  // Exercise future-table DML and its generated sequence with the actual limited role.
  for(const tenant of [{id:1,slug:'owned-one'},{id:2,slug:'owned-two'}])
    await app.invoke({kind:'command',tenant,actor:{kind:'system',policy:'fixture.postgres-future-grants'}},({database,policy})=>policy.run(database,{kind:'tenant',tenantId:tenant.id},async(selected)=>{
      const future=selected.repository(futureNotes);
      const before=await future.findAll();assert.equal(before.length,1);assert.equal(before[0]?.tenant_id,tenant.id);
      const created=await future.create({body:'future-created',tenant_id:tenant.id});
      assert.ok(Number.isSafeInteger(created.id)&&created.id>0,'Future-table insert must use its native generated sequence.');
      assert.equal((await future.findById(created.id))?.body,'future-created');
      await future.updateById(created.id,{body:'future-updated'});
      assert.equal((await future.findById(created.id))?.body,'future-updated');
      assert.equal(await future.deleteById(created.id),true);
      const after=await future.findAll();assert.equal(after.length,1);assert.equal(after[0]?.tenant_id,tenant.id);
    }));
  for(const table of ['notes','acl_future_notes']){
    const [sequence]=await sql.unsafe<{name:string}[]>("SELECT pg_get_serial_sequence($1,'id') AS name",[table]);assert.ok(sequence?.name);
    for(const privilege of ['USAGE','SELECT','UPDATE']){
      const [grant]=await sql.unsafe<{allowed:boolean}[]>("SELECT has_sequence_privilege(current_user,$1,$2) AS allowed",[sequence.name,privilege]);
      assert.equal(grant?.allowed,privilege!=='UPDATE');
    }
  }
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

} catch(error){errors.push(error);}
if(sql)try{await sql.close();}catch(error){errors.push(error);}
if(owner)try{const result=await owner.stop({reason:'Postgres grant contract complete'});if(!result.successful)throw new Error('Postgres grant owner did not stop cleanly',{cause:result});}catch(error){errors.push(error);}
if(errors.length===1)throw errors[0];if(errors.length>1)throw new AggregateError(errors,'Postgres grant contract and cleanup failed.');
  console.log(
    JSON.stringify({
      actualGeneratedRuntimeRole: true,
      ormTwoTenantCrud: true,
      failedJobPersistence: true,
      currentAndFutureMaintenanceDenied: true,
    }),
  );
`;
try {
  checkInterrupted();
  admin = new SQL({ url: fixture.migrationUrl, max: 1 });
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
  checkInterrupted();
} catch (error) {
  failures.push(error);
} finally {
  // Restore the serial fixture role, then independently release every acquired owner.
  if (provisioningStarted && admin) {
    try {
      const [quoted] = await admin.unsafe<{ password: string }[]>(
        "SELECT quote_literal($1) AS password",
        [originalPassword],
      );
      assert.ok(quoted);
      await admin.unsafe(`ALTER ROLE strata_app PASSWORD ${quoted.password}`);
    } catch (error) {
      failures.push(error);
    }
    let restored: SQL | undefined;
    try {
      restored = new SQL({ url: fixture.runtimeUrl, max: 1 });
      const [identity] = await restored.unsafe<{ current_user: string }[]>("SELECT current_user");
      assert.equal(
        identity?.current_user,
        "strata_app",
        "Original configured credential must work again.",
      );
    } catch (error) {
      failures.push(error);
    }
    if (restored)
      try {
        await restored.close();
      } catch (error) {
        failures.push(error);
      }
  }
  if (admin)
    try {
      await admin.close();
    } catch (error) {
      failures.push(error);
    }
  try {
    await fixture.close();
  } catch (error) {
    failures.push(error);
  }
  if (interrupted) failures.push(interruption);
  process.removeListener("SIGTERM", terminate);
}
throwFailures(failures, "Postgres runtime grants verification and cleanup failed.");
console.log(
  JSON.stringify({
    installedPostgresRuntimeGrants: true,
    fresh: true,
    repairedByCli: true,
    emittedInitAndRepeatableSql: true,
    noRuntimeAdminCredentials: true,
  }),
);
