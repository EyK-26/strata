/** Later-batch generated billing rollback/reapply against owned SQL and public ORM/Schema APIs. */
import assert from "node:assert/strict";
import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createGeneratedSecurityApp } from "../tests/helpers/generatedSecurityApp";

const database = process.argv.find((arg) => arg.startsWith("--database="))?.slice(11);
const tenancy = process.argv.find((arg) => arg.startsWith("--tenancy="))?.slice(10);
const webhooks = process.argv.includes("--webhooks");
assert.ok(database === "sqlite" || database === "mysql" || database === "postgres");
assert.ok(
  tenancy === "none" || tenancy === "column" || (database === "postgres" && tenancy === "rls"),
);
const publishedVersion = process.argv.find((arg) => arg.startsWith("--published="))?.slice(12);
const fixture = await createGeneratedSecurityApp(
  database,
  [
    "--frontend=api",
    "--auth=cookie",
    `--tenancy=${tenancy}`,
    "--billing",
    webhooks ? "--webhooks" : "--no-webhooks",
    "--cache=array",
    "--queue=sync",
    "--mail=log",
    "--no-docker",
    "--no-mfa",
    "--no-email-verification",
    "--no-scim",
    "--no-metrics",
  ],
  { publishedVersion },
);
const env = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(([key]) =>
      ["PATH", "HOME", "TMPDIR", "USER", "SHELL"].includes(key),
    ),
  ),
  APP_ENV: "local",
  DATABASE_URL: fixture.runtimeUrl,
  APP_DATABASE_URL: fixture.runtimeUrl,
  SESSION_SECRET: crypto.randomUUID() + crypto.randomUUID(),
  TENANCY_DRIVER: tenancy,
  OTEL_SDK_DISABLED: "true",
};
const cli = join(fixture.app, "node_modules/@getstrata/cli/cli.ts");
const failures: unknown[] = [];
const activeChildren = new Set<ReturnType<typeof Bun.spawn<"ignore", "pipe", "pipe">>>();
let terminationTimer: ReturnType<typeof setTimeout> | undefined;
let interrupted = false;
const interruption = new Error("Command data verification interrupted by SIGTERM.");
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
  // The body observes every owned child before its finally releases the fixture.
  for (const child of activeChildren) {
    try {
      if (child.exitCode === null) child.kill("SIGTERM");
    } catch (error) {
      failures.push(error);
    }
  }
  if (activeChildren.size)
    terminationTimer ??= setTimeout(() => {
      for (const child of activeChildren) {
        try {
          if (child.exitCode === null) child.kill("SIGKILL");
        } catch (error) {
          failures.push(error);
        }
      }
    }, 5000);
};
process.once("SIGTERM", terminate);
async function run(
  args: string[],
  options: { input?: string; admin?: boolean; mode?: string } = {},
) {
  checkInterrupted();
  const child = Bun.spawn([process.execPath, ...args], {
    cwd: fixture.app,
    env: {
      ...env,
      // An empty runtime migration URL also prevents generated development preload fallback.
      MIGRATION_DATABASE_URL: options.admin ? fixture.migrationUrl : "",
      ...(options.admin
        ? { DATABASE_URL: fixture.migrationUrl, APP_DATABASE_URL: fixture.migrationUrl }
        : {}),
      ...(options.mode ? { APP_ENV: options.mode } : {}),
    },
    stdin: options.input ? new TextEncoder().encode(options.input) : "ignore",
    stdout: "pipe",
    stderr: "pipe",
    timeout: 60000,
    killSignal: "SIGKILL",
  });
  activeChildren.add(child);
  try {
    const results = await Promise.allSettled([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ] as const);
    const errors = results.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    if (interrupted) errors.push(interruption);
    throwFailures(errors, "Command data child exit/output collection failed.");
    const [terminal, out, err] = results;
    if (terminal.status !== "fulfilled" || out.status !== "fulfilled" || err.status !== "fulfilled")
      throw new Error("Command data child channels did not settle successfully.");
    return { code: terminal.value, output: out.value + err.value };
  } finally {
    activeChildren.delete(child);
    if (!activeChildren.size) {
      if (terminationTimer) clearTimeout(terminationTimer);
      terminationTimer = undefined;
    }
  }
}
async function successful(args: string[], options: Parameters<typeof run>[1] = {}) {
  const result = await run(args, options);
  assert.equal(result.code, 0, result.output);
  return result.output;
}
const probe = `import assert from 'node:assert/strict';
import type {Application} from '@getstrata/core/contracts/application';
import {BaseRepository} from '@getstrata/core/database/baseRepository';
import {defineRepository} from '@getstrata/core/database/definitions';
import {defineTable} from '@getstrata/core/database/table';
import {PersistenceError} from '@getstrata/core/database/errors';
import {bootstrapApp} from './src/bootstrap/createApp.ts';
assert.equal(process.env.MIGRATION_DATABASE_URL??'','');
const subscriptions=defineRepository({name:'FixtureSubscriptions',table:defineTable<{id:number;plan:string;status:string},'id'>({name:'subscription',primaryKey:'id',columns:['id','plan','status']}),dependencies:[],create:binding=>new BaseRepository(binding)});
const events=defineRepository({name:'FixtureStripeEvents',table:defineTable<{id:string;event_type:string},'id'>({name:'stripe_webhook_event',primaryKey:'id',columns:['id','event_type']}),dependencies:[],create:binding=>new BaseRepository(binding)});
const tenants=defineRepository({name:'FixtureBillingTenants',table:defineTable<{id:number;slug:string;unrelated_marker:string},'id'>({name:'tenant',primaryKey:'id',columns:['id','slug','unrelated_marker']}),dependencies:[],create:binding=>new BaseRepository(binding)});
const envelope={kind:'command' as const,actor:{kind:'system' as const,policy:'fixture.billing-schema-inventory'}};
function missingTable(error:unknown,table:string):boolean{
 if(error instanceof PersistenceError)return error.code==='DATABASE_OPERATION_FAILED'&&missingTable(error.cause,table);
 if(error instanceof AggregateError)return error.errors.length>0&&error.errors.every(cause=>missingTable(cause,table));
 if(!(error instanceof Error))return false;
 const code=Reflect.get(error,'code')${database === "postgres" ? ",errno=Reflect.get(error,'errno')" : ""};
 return ${database === "sqlite" ? "code==='SQLITE_ERROR'&&error.message.includes('no such table: '+table)" : database === "mysql" ? "code==='ER_NO_SUCH_TABLE'&&error.message.includes('.'+table)" : "(errno==='42P01'||code==='42P01')&&error.message.includes('relation \"'+table+'\" does not exist')"};
}
let owner:Application|undefined;const errors:unknown[]=[];
try{
 const app=await bootstrapApp({migrate:false,mode:'command',persistence:{repositories:[subscriptions,events${tenancy === "none" ? "" : ",tenants"}]},onConstructed:application=>{owner=application;return undefined;}});
 if(process.argv[2]==='prepare')await app.invoke(envelope,async({database})=>{
  const row=await database.repository(tenants).create({slug:'owned-tenant',unrelated_marker:'preserve-me'});assert.equal(row.id,1);
 });
 else if(process.argv[2]==='present')await app.invoke(envelope,async({database})=>{
  assert.equal(await database.repository(subscriptions).count(),0);assert.equal(await database.repository(events).count(),0);
 });
 else if(process.argv[2]==='absent'){
  // Each expected failed query owns a separate invocation, with a native table-absence witness.
  await assert.rejects(()=>app.invoke(envelope,({database})=>database.repository(subscriptions).count()),error=>missingTable(error,'subscription'));
  await assert.rejects(()=>app.invoke(envelope,({database})=>database.repository(events).count()),error=>missingTable(error,'stripe_webhook_event'));
 }else assert.equal(process.argv[2],'controls');
 // Successful work after the failed invocations must still read the unrelated row and column.
 ${tenancy === "none" ? "" : "await app.invoke(envelope,async({database})=>{assert.deepEqual(await database.repository(tenants).findById(1),{id:1,slug:'owned-tenant',unrelated_marker:'preserve-me'});});"}
}catch(error){errors.push(error);}
if(owner)try{const stopped=await owner.stop({reason:'Billing schema probe complete'});if(!stopped.successful)throw new Error('Billing data owner did not stop cleanly',{cause:stopped});}catch(error){errors.push(error);}
if(errors.length===1)throw errors[0];if(errors.length>1)throw new AggregateError(errors,'Billing schema probe and cleanup failed.');
`;
async function controls() {
  await successful(["billing-data-probe.ts", "controls"]);
}
try {
  await writeFile(
    join(fixture.app, ".env"),
    (await readFile(join(fixture.app, ".env.example"), "utf8")).replace(
      /^MIGRATION_DATABASE_URL=.*$/gm,
      "MIGRATION_DATABASE_URL=",
    ),
  );
  await writeFile(join(fixture.app, "billing-data-probe.ts"), probe);
  const file = `${webhooks ? "0003" : "0002"}_billing_schema.ts`,
    migration = join(fixture.app, "src/db/migrations", file),
    held = join(fixture.app, "pending-billing.ts");
  await rename(migration, held);
  await successful([cli, "migrate"], { admin: true });
  if (tenancy !== "none") {
    await successful(
      [
        "-e",
        `import {Schema} from '@getstrata/core/database/schema';import {withMigrationDatabase} from './src/db/migrationRuntime.ts';await withMigrationDatabase(db=>Schema.run(db,${JSON.stringify(database === "postgres" ? "pgsql" : database)},schema=>schema.table('tenant',table=>{table.text('unrelated_marker').nullable();})));`,
      ],
      { admin: true },
    );
    await successful(["billing-data-probe.ts", "prepare"]);
  }
  await rename(held, migration);
  await successful([cli, "migrate"], { admin: true });
  await controls();
  await successful(["billing-data-probe.ts", "present"]);
  const rolledBack = await successful(["run", "src/db/rollback.ts"], { admin: true });
  assert.ok(rolledBack.includes(file.replace(/\.ts$/, "")));
  await controls();
  await successful(["billing-data-probe.ts", "absent"]);
  await successful([cli, "migrate"], { admin: true });
  await controls();
  await successful(["billing-data-probe.ts", "present"]);
  await successful([cli, "migrate"], { admin: true });
  const rolledBackAgain = await successful(["run", "src/db/rollback.ts"], { admin: true });
  assert.ok(rolledBackAgain.includes(file.replace(/\.ts$/, "")));
  await controls();
  await successful(["billing-data-probe.ts", "absent"]);
  await successful([cli, "migrate"], { admin: true });
  await controls();
  await successful(["billing-data-probe.ts", "present"]);
  checkInterrupted();
} catch (error) {
  failures.push(error);
} finally {
  try {
    await fixture.close();
  } catch (error) {
    failures.push(error);
  }
  if (interrupted) failures.push(interruption);
  process.removeListener("SIGTERM", terminate);
}
throwFailures(failures, "Billing rollback verification and cleanup failed.");
console.log(
  `PASS ${database}/${tenancy}/webhooks=${webhooks}: two later-batch billing rollback/reapply cycles preserve unrelated tenant schema and data`,
);
