/** Real generated MySQL CLI with separate schema and limited runtime credentials. */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createGeneratedSecurityApp } from "../tests/helpers/generatedSecurityApp";

const tenancy = process.argv.find((a) => a.startsWith("--tenancy="))?.slice(10);
assert.ok(tenancy === "none" || tenancy === "column");
const publishedVersion = process.argv.find((a) => a.startsWith("--published="))?.slice(12);
const fixture = await createGeneratedSecurityApp(
  "mysql",
  [
    "--frontend=server-htmx",
    "--auth=cookie",
    `--tenancy=${tenancy}`,
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
    Object.entries(process.env).filter(([k]) =>
      ["PATH", "HOME", "TMPDIR", "USER", "SHELL"].includes(k),
    ),
  ),
  APP_ENV: "local",
  APP_URL: "http://localhost:3000",
  DATABASE_URL: fixture.runtimeUrl,
  APP_DATABASE_URL: fixture.runtimeUrl,
  MIGRATION_DATABASE_URL: fixture.migrationUrl,
  TENANCY_DRIVER: tenancy,
  SESSION_SECRET: crypto.randomUUID() + crypto.randomUUID(),
  OTEL_SDK_DISABLED: "true",
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
async function run(args: string[], expected = 0) {
  checkInterrupted();
  const child = Bun.spawn([process.execPath, ...args], {
    cwd: fixture.app,
    env,
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
        assert.equal(terminal.value, expected, output);
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
try {
  await writeFile(
    join(fixture.app, ".env"),
    await readFile(join(fixture.app, ".env.example"), "utf8"),
  );
  await writeFile(
    join(fixture.app, "runtime-probe.ts"),
    `import assert from 'node:assert/strict';
import type {Application} from '@getstrata/core/contracts/application';
import {PersistenceError} from '@getstrata/core/database/errors';
import {bootstrapApp} from './src/bootstrap/createApp.ts';
import {User} from './src/models/User.ts';
let owner:Application|undefined;const errors:unknown[]=[];
const envelope={kind:'command' as const,actor:{kind:'system' as const,policy:'fixture.mysql-runtime'}${tenancy === "column" ? ",tenant:{id:1,slug:'default'}" : ""}};
function nativeDdlDenial(error:unknown):boolean{
 if(error instanceof PersistenceError)return error.code==='DATABASE_OPERATION_FAILED'&&nativeDdlDenial(error.cause);
 if(error instanceof AggregateError)return error.errors.length>0&&error.errors.every(nativeDdlDenial);
 return error!==null&&typeof error==='object'&&'code' in error&&error.code==='ER_TABLEACCESS_DENIED_ERROR';
}
try{
 const app=await bootstrapApp({migrate:false,mode:'command',onConstructed:application=>{owner=application;return undefined;}});
 await app.invoke(envelope,async({database})=>{
  const [identity]=await database.execute<{account:string}>({text:'SELECT CURRENT_USER() AS account',params:[]});
  assert.equal(identity?.account,${JSON.stringify(`${decodeURIComponent(new URL(fixture.runtimeUrl).username)}@%`)});
  const users=database.model(User);
  assert.equal(await users.${tenancy === "column" ? "where({tenant_id:1})" : "query()"}.count(),Number(process.argv[2]));
 });
 // A failed operation ends its invocation; later probes must use a fresh invocation.
 await assert.rejects(()=>app.invoke(envelope,({database})=>database.execute({text:'CREATE TABLE runtime_must_not_have_ddl (id INTEGER)',params:[]})),nativeDdlDenial);
}catch(error){errors.push(error);}
if(owner)try{const result=await owner.stop({reason:'MySQL runtime probe complete'});if(!result.successful)throw new Error('MySQL runtime owner did not stop cleanly',{cause:result});}catch(error){errors.push(error);}
if(errors.length===1)throw errors[0];if(errors.length>1)throw new AggregateError(errors,'MySQL runtime probe and cleanup failed.');
`,
  );
  await writeFile(
    join(fixture.app, "privilege-context.ts"),
    `import assert from 'node:assert/strict';
import type {Application} from '@getstrata/core/contracts/application';
import {PersistenceError} from '@getstrata/core/database/errors';
import {Schema} from '@getstrata/core/database/schema';
import {bootstrapApp} from './src/bootstrap/createApp.ts';
import {withMigrationDatabase} from './src/db/migrationRuntime.ts';
let owner:Application|undefined;const errors:unknown[]=[];
const envelope={kind:'command' as const,actor:{kind:'system' as const,policy:'fixture.mysql-migration-context'}};
function nativeDdlDenial(error:unknown):boolean{
 if(error instanceof PersistenceError)return error.code==='DATABASE_OPERATION_FAILED'&&nativeDdlDenial(error.cause);
 if(error instanceof AggregateError)return error.errors.length>0&&error.errors.every(nativeDdlDenial);
 return error!==null&&typeof error==='object'&&'code' in error&&error.code==='ER_TABLEACCESS_DENIED_ERROR';
}
try{
 const app=await bootstrapApp({migrate:false,mode:'command',onConstructed:application=>{owner=application;return undefined;}});
 const sentinel=new Error('expected migration callback failure');
 await assert.rejects(()=>withMigrationDatabase(async(db)=>{
  await Schema.run(db,'mysql',schema=>schema.create('admin_scope_probe',table=>table.id()));
  throw sentinel;
 }),error=>error===sentinel);
 // MySQL DDL may persist despite callback failure; no DDL rollback guarantee is asserted.
 await app.invoke(envelope,async({database})=>{
  const [identity]=await database.execute<{account:string}>({text:'SELECT CURRENT_USER() AS account',params:[]});
  assert.equal(identity?.account,${JSON.stringify(`${decodeURIComponent(new URL(fixture.runtimeUrl).username)}@%`)});
  const rows=await database.execute({text:'SELECT id FROM admin_scope_probe',params:[]});assert.equal(rows.length,0);
 });
 await assert.rejects(()=>app.invoke(envelope,({database})=>database.execute({text:'CREATE TABLE runtime_context_must_stay_limited (id INTEGER)',params:[]})),nativeDdlDenial);
}catch(error){errors.push(error);}
if(owner)try{const result=await owner.stop({reason:'MySQL migration context probe complete'});if(!result.successful)throw new Error('MySQL migration context owner did not stop cleanly',{cause:result});}catch(error){errors.push(error);}
if(errors.length===1)throw errors[0];if(errors.length>1)throw new AggregateError(errors,'MySQL migration context probe and cleanup failed.');
`,
  );
  const cli = join(fixture.app, "node_modules/@getstrata/cli/cli.ts");
  await run(["run", "db:migrate", "--seed"]);
  await run(["runtime-probe.ts", "2"]);
  await run(["privilege-context.ts"]);
  const guarded = await run(["run", "src/db/rollback.ts"], 1);
  assert.ok(
    guarded.includes(
      "Removing account state requires an explicit administrative credential-reset procedure.",
    ),
  );
  await run(["runtime-probe.ts", "2"]);
  // A harmless later batch can roll back normally without touching protected account state.
  await writeFile(
    join(fixture.app, "src/db/migrations/9999_runtime_role_marker.ts"),
    `import type {Migration} from '@getstrata/core/database/migrations/types';
import {Schema} from '@getstrata/core/database/schema';
export default {name:'9999_runtime_role_marker',async up(db){await Schema.run(db,'mysql',s=>s.create('runtime_role_marker',t=>t.id()));},async down(db){await Schema.run(db,'mysql',s=>s.drop('runtime_role_marker'));}} satisfies Migration;
`,
  );
  await run(["run", "src/db/status.ts"]);
  await run([cli, "migrate"]);
  await run(["runtime-probe.ts", "2"]);
  await run(["run", "src/db/rollback.ts"]);
  const pending = await run(["run", "src/db/status.ts"]);
  assert.ok(pending.includes("[pending] 9999_runtime_role_marker"));
  await run([cli, "migrate"]);
  await run(["runtime-probe.ts", "2"]);
  await run([cli, "migrate:fresh", "--seed"]);
  await run(["runtime-probe.ts", "2"]);
  await run([cli, "migrate:fresh"]);
  await run(["runtime-probe.ts", "0"]);
  await run([cli, "migrate", "--seed"]);
  await run(["runtime-probe.ts", "2"]);
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
throwFailures(failures, "MySQL migration-role verification and cleanup failed.");
console.log(
  `PASS mysql/${tenancy}: actual migrate/status/rollback/fresh/reapply and seed; runtime ORM reads work while runtime DDL stays denied`,
);
