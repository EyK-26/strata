/** Generated CLI lifecycle, real owned SQL, and the published ORM. No app-source workaround. */
import assert from "node:assert/strict";
import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createGeneratedSecurityApp } from "../tests/helpers/generatedSecurityApp";

const database = process.argv.find((arg) => arg.startsWith("--database="))?.slice(11);
const tenancy = process.argv.find((arg) => arg.startsWith("--tenancy="))?.slice(10);
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
import {bootstrapApp} from './src/bootstrap/createApp.ts';
import {User} from './src/models/User.ts';
assert.equal(process.env.MIGRATION_DATABASE_URL??'','');
const claims=defineRepository({name:'FixtureAdminClaims',table:defineTable<{id:number;email:string;provisioned_at:Date|string},'id'>({name:'initial_admin_provisioning',primaryKey:'id',columns:['id','email','provisioned_at']}),dependencies:[],create:binding=>new BaseRepository(binding)});
const tenants=defineRepository({name:'FixtureAdminTenants',table:defineTable<{id:number;slug:string},'id'>({name:'tenant',primaryKey:'id',columns:['id','slug']}),dependencies:[],create:binding=>new BaseRepository(binding)});
let owner:Application|undefined;const errors:unknown[]=[];let result:unknown;
try{
 const app=await bootstrapApp({migrate:false,mode:'command',persistence:{repositories:[claims${tenancy === "none" ? "" : ",tenants"}]},onConstructed:application=>{owner=application;return undefined;}});
 result=await app.invoke({kind:'command',actor:{kind:'system',policy:'fixture.admin-account-inventory'}},async({database${database === "postgres" ? ",policy" : ""}})=>{
  const inspect=async(selected:import('@getstrata/core/contracts/persistence').SelectedSession)=>{
   if(process.argv[2]==='prepare'){
    const tenant=await selected.repository(tenants).create({slug:'owned-test'});assert.equal(tenant.id,1);return null;
   }
   assert.equal(process.argv[2],'counts');
   const users=selected.model(User);const claimRepository=selected.repository(claims);
   const userCount=await users.query().count();const claimCount=await claimRepository.count();
   if(claimCount===1){
    const claim=await claimRepository.findById(1);assert.ok(claim);
    assert.equal(await users.where({email:claim.email${tenancy === "none" ? "" : ",tenant_id:1"}}).count(),1,'The completed claim must identify its single scoped account.');
   }
   return {users:userCount,claims:claimCount};
  };
  return ${database === "postgres" ? "policy.run(database,{kind:'bypass'},inspect)" : "inspect(database)"};
 });
}catch(error){errors.push(error);}
if(owner)try{const stopped=await owner.stop({reason:'Admin data probe complete'});if(!stopped.successful)throw new Error('Admin data owner did not stop cleanly',{cause:stopped});}catch(error){errors.push(error);}
if(errors.length===1)throw errors[0];if(errors.length>1)throw new AggregateError(errors,'Admin data probe and cleanup failed.');
console.log(JSON.stringify(result));
`;
async function prepareTenant() {
  if (tenancy !== "none") await successful(["admin-data-probe.ts", "prepare"]);
}
async function counts() {
  return JSON.parse((await successful(["admin-data-probe.ts", "counts"])).trim());
}
function provision(email: string) {
  return run(
    [
      cli,
      "auth:provision-admin",
      "--email",
      email,
      "--name",
      "Owned Test Admin",
      "--password-stdin",
      ...(tenancy === "none" ? [] : ["--tenant", "1"]),
    ],
    { input: "OwnedQualificationPassword!123\n" },
  );
}
try {
  await writeFile(
    join(fixture.app, ".env"),
    (await readFile(join(fixture.app, ".env.example"), "utf8")).replace(
      /^MIGRATION_DATABASE_URL=.*$/gm,
      "MIGRATION_DATABASE_URL=",
    ),
  );
  await writeFile(join(fixture.app, "admin-data-probe.ts"), probe);
  // Isolate the claim in a later batch so a real ordinary rollback reaches its guard first.
  const migration = join(fixture.app, "src/db/migrations/0004_initial_admin_provisioning.ts");
  const held = join(fixture.app, "pending-admin.ts");
  await rename(migration, held);
  await successful([cli, "migrate"], { admin: true });
  await rename(held, migration);
  await successful([cli, "migrate"], { admin: true });
  await prepareTenant();
  assert.deepEqual(await counts(), { users: 0, claims: 0 });
  const first = await provision("initial@example.test");
  assert.equal(first.code, 0, first.output);
  assert.deepEqual(await counts(), { users: 1, claims: 1 });
  const rollback = await run(["run", "src/db/rollback.ts"], { admin: true });
  assert.notEqual(rollback.code, 0);
  assert.ok(
    rollback.output.includes("Cannot discard a completed initial-admin provisioning claim."),
  );
  assert.deepEqual(await counts(), { users: 1, claims: 1 });
  for (const mode of ["production", "staging"]) {
    const denied = await run([cli, "migrate:fresh"], { admin: true, mode });
    assert.notEqual(denied.code, 0);
    assert.ok(denied.output.includes("only available in development/test"));
    assert.deepEqual(await counts(), { users: 1, claims: 1 });
  }
  await successful([cli, "migrate:fresh"], { admin: true });
  assert.deepEqual(await counts(), { users: 0, claims: 0 });
  await successful([cli, "migrate"], { admin: true });
  await prepareTenant();
  const observations = await Promise.allSettled([
    provision("race-a@example.test"),
    provision("race-b@example.test"),
  ]);
  const raceErrors = observations.flatMap((result) =>
    result.status === "rejected" ? [result.reason] : [],
  );
  throwFailures(raceErrors, "Both concurrent admin claimants were observed before failure.");
  const race = observations.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : [],
  );
  assert.equal(race.length, 2);
  const diagnostic = race.map((result) => `exit=${result.code}: ${result.output}`).join("\n");
  assert.equal(
    race.filter((result) => result.code === 0).length,
    1,
    `One concurrent claimant must win.\n${diagnostic}`,
  );
  const loser = race.find((result) => result.code !== 0);
  assert.ok(loser, diagnostic);
  assert.equal(loser.code, 1, diagnostic);
  assert.ok(
    loser.output.includes(
      "Initial-admin provisioning failed. Check schema, tenant, existing admins/accounts and the one-time claim; no account is promoted or overwritten.",
    ),
    diagnostic,
  );
  const winner = race.find((result) => result.code === 0);
  assert.ok(
    winner?.output.includes(
      "Initial admin provisioned. Complete email verification and MFA through the application.",
    ),
    diagnostic,
  );
  assert.deepEqual(await counts(), { users: 1, claims: 1 });
  await successful([cli, "migrate:fresh", "--seed"], { admin: true });
  assert.deepEqual(await counts(), { users: 2, claims: 0 });
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
throwFailures(failures, "Admin reset verification and cleanup failed.");
console.log(
  `PASS ${database}/${tenancy}: real admin provisioning, protected rollback, production/staging refusal, explicit local reset and concurrent claim`,
);
