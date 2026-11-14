/** Account-free development identities use the framework tenant policy on real generated apps. */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createGeneratedSecurityApp } from "../tests/helpers/generatedSecurityApp";

const database = process.argv.find((a) => a.startsWith("--database="))?.slice(11);
const tenancy = process.argv.find((a) => a.startsWith("--tenancy="))?.slice(10);
assert.ok(database === "sqlite" || database === "mysql" || database === "postgres");
assert.ok(tenancy === "column" || (database === "postgres" && tenancy === "rls"));
const publishedVersion = process.argv.find((a) => a.startsWith("--published="))?.slice(12);
const fixture = await createGeneratedSecurityApp(
  database,
  [
    "--frontend=api",
    "--auth=headers",
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
let reservation: ReturnType<typeof Bun.serve> | undefined;
let origin = "";
const env = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(([k]) =>
      ["PATH", "HOME", "TMPDIR", "USER", "SHELL"].includes(k),
    ),
  ),
  APP_ENV: "local",
  PORT: "0",
  HOST: "127.0.0.1",
  APP_URL: origin,
  DATABASE_URL: fixture.runtimeUrl,
  APP_DATABASE_URL: fixture.runtimeUrl,
  MIGRATION_DATABASE_URL: "",
  TENANCY_DRIVER: tenancy,
  AUTH_DEV_HEADERS: "true",
  TENANT_DEV_HEADERS: "false",
  OTEL_SDK_DISABLED: "true",
};
const failures: unknown[] = [];
type PipedChild = ReturnType<typeof Bun.spawn<"ignore", "pipe", "pipe">>;
const activeCommands = new Set<PipedChild>();
let server: PipedChild | undefined;
let serverObservation: Promise<PromiseSettledResult<unknown>[]> | undefined;
let serverOutput = "",
  serverError = "";
let interrupted = false;
const interruption = new Error("Guest tenancy verification interrupted by SIGTERM.");
const cancellation = new AbortController();
let terminationTimer: ReturnType<typeof setTimeout> | undefined;
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
  cancellation.abort(interruption);
  for (const child of [server, ...activeCommands]) {
    try {
      if (child?.exitCode === null) child.kill("SIGTERM");
    } catch (error) {
      failures.push(error);
    }
  }
  terminationTimer ??= setTimeout(() => {
    for (const child of [server, ...activeCommands]) {
      try {
        if (child?.exitCode === null) child.kill("SIGKILL");
      } catch (error) {
        failures.push(error);
      }
    }
  }, 10000);
};
process.once("SIGTERM", terminate);
function http(input: string, init: RequestInit = {}): Promise<Response> {
  checkInterrupted();
  return fetch(input, {
    ...init,
    signal: AbortSignal.any([cancellation.signal, init.signal ?? AbortSignal.timeout(10000)]),
  });
}
async function capture(
  stream: ReadableStream<Uint8Array>,
  append: (value: string) => void,
): Promise<void> {
  const reader = stream.getReader(),
    decoder = new TextDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      append(decoder.decode(value, { stream: true }));
    }
    append(decoder.decode());
  } finally {
    reader.releaseLock();
  }
}
async function run(args: string[], migration = false): Promise<void> {
  checkInterrupted();
  const child = Bun.spawn([process.execPath, ...args], {
    cwd: fixture.app,
    env: migration
      ? {
          ...env,
          DATABASE_URL: fixture.migrationUrl,
          APP_DATABASE_URL: fixture.migrationUrl,
          MIGRATION_DATABASE_URL: fixture.migrationUrl,
        }
      : env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    timeout: 60000,
    killSignal: "SIGKILL",
  });
  activeCommands.add(child);
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
    const output =
      (out.status === "fulfilled" ? out.value : "") + (err.status === "fulfilled" ? err.value : "");
    if (terminal.status === "fulfilled")
      try {
        assert.equal(terminal.value, 0, `Installed child ${args[0]} failed:\n${output}`);
      } catch (error) {
        errors.push(error);
      }
    if (interrupted) errors.push(interruption);
    throwFailures(errors, "Guest tenancy child exit/output collection failed.");
  } finally {
    activeCommands.delete(child);
  }
}
const cli = join(fixture.app, "node_modules/@getstrata/cli/cli.ts");
async function stopServer(): Promise<void> {
  const child = server;
  if (!child) return;
  const errors: unknown[] = [];
  try {
    if (child.exitCode === null) child.kill("SIGTERM");
  } catch (error) {
    errors.push(error);
  }
  let forced = false;
  const timer = setTimeout(() => {
    try {
      if (child.exitCode === null) {
        forced = true;
        child.kill("SIGKILL");
      }
    } catch (error) {
      errors.push(error);
    }
  }, 10000);
  try {
    if (!serverObservation) errors.push(new Error("Official CLI observation was not registered."));
    const results = await (serverObservation ?? Promise.allSettled([child.exited]));
    for (const result of results) if (result.status === "rejected") errors.push(result.reason);
    const terminal = results[0];
    if (terminal?.status === "fulfilled")
      try {
        assert.equal(forced, false, "Official CLI must stop after SIGTERM.");
        assert.equal(
          terminal.value,
          0,
          `Official CLI must drain and exit successfully:\n${serverOutput}\n${serverError}`,
        );
      } catch (error) {
        errors.push(error);
      }
  } catch (error) {
    errors.push(error);
  } finally {
    clearTimeout(timer);
  }
  try {
    // Cleanup owns its deadline independently of body cancellation.
    await assert.rejects(
      () => fetch(`${origin}/health`, { signal: AbortSignal.timeout(2000) }),
      "The owned HTTP listener must stop before reboot or fixture removal.",
    );
  } catch (error) {
    errors.push(error);
  }
  server = undefined;
  serverObservation = undefined;
  throwFailures(errors, "Guest tenancy official CLI shutdown failed.");
}
async function start(): Promise<void> {
  checkInterrupted();
  assert.equal(server, undefined, "Join the previous immutable application before reboot.");
  serverOutput = "";
  serverError = "";
  server = Bun.spawn([process.execPath, cli, "start"], {
    cwd: fixture.app,
    // Official local start owns automatic schema setup; runtime URLs remain restricted.
    env: { ...env, MIGRATION_DATABASE_URL: fixture.migrationUrl },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  serverObservation = Promise.allSettled([
    server.exited,
    capture(server.stdout, (value) => {
      serverOutput = (serverOutput + value).slice(-32768);
    }),
    capture(server.stderr, (value) => {
      serverError = (serverError + value).slice(-32768);
    }),
  ]);
  let ready = false,
    health = "No HTTP response";
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    checkInterrupted();
    try {
      const response = await http(`${origin}/health`, { signal: AbortSignal.timeout(1000) });
      ready = response.ok;
      health = `${response.status}: ${await response.text()}`;
    } catch (error) {
      health = error instanceof Error ? error.message : String(error);
    }
    if (ready || server.exitCode !== null) break;
    await Bun.sleep(100);
  }
  checkInterrupted();
  assert.ok(
    ready,
    `Generated header application must become ready (${health}; exit ${server.exitCode}):\n${serverOutput}\n${serverError}`,
  );
}
async function request(extra: Record<string, string>, status = 200) {
  const response = await http(`${origin}/api/v1/guest-notes`, { headers: extra });
  assert.equal(response.status, status, await response.clone().text());
  return response;
}
try {
  checkInterrupted();
  reservation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
  const port = reservation.port;
  assert.ok(port);
  await reservation.stop(true);
  reservation = undefined;
  origin = `http://127.0.0.1:${port}`;
  env.APP_URL = origin;
  env.PORT = String(port);
  await writeFile(
    join(fixture.app, ".env"),
    (await readFile(join(fixture.app, ".env.example"), "utf8")).replace(
      /^MIGRATION_DATABASE_URL=.*$/gm,
      "MIGRATION_DATABASE_URL=",
    ),
  );
  assert.equal(
    existsSync(join(fixture.app, "src/models/User.ts")),
    false,
    "Header apps must remain account-free",
  );
  await mkdir(join(fixture.app, "src/modules/guest-notes"), { recursive: true });
  await writeFile(
    join(fixture.app, "src/modules/guest-notes/index.ts"),
    `import type {AppModule} from '@getstrata/bootstrap/contracts';
import {jsonResponse} from '@getstrata/core/http/response';
import {parseJsonBody} from '@getstrata/core/http/validation';
import {required,stringRule,validateObject} from '@getstrata/core/validation/rules';
import {Note} from '../../models/Note.ts';
export default {name:'guest-notes',routes({kernel}){return {'/api/v1/guest-notes':{
 GET:kernel.wrapApi(async(request,ports)=>{
  const user=await ports.auth.requireUser(request);const tenantId=ports.established.tenant.id;
  const notes=await ports.database.model(Note).where({tenant_id:tenantId}).get();
  return jsonResponse({userId:user.id,source:ports.established.auth.credentialSource,tenantId,notes:notes.map(note=>note.toObject())});
 }),
 POST:kernel.wrapApi(async(request,ports)=>{
  await ports.auth.requireUser(request);
  const fields=await parseJsonBody(request,input=>validateObject(input,{body:[required(),stringRule()]}));
  const note=await ports.database.model(Note).create({body:String(fields.body),tenant_id:ports.established.tenant.id});
  return jsonResponse(note.toObject(),{status:201});
 })
}};}} satisfies AppModule;
`,
  );
  await run(["run", "check"]);
  await run(["run", "db:migrate", "--seed"], true);
  await writeFile(
    join(fixture.app, "other-tenant.ts"),
    `import assert from 'node:assert/strict';
import type {Application} from '@getstrata/core/contracts/application';
import type {SelectedSession} from '@getstrata/core/contracts/persistence';
import {BaseRepository} from '@getstrata/core/database/baseRepository';
import {defineRepository} from '@getstrata/core/database/definitions';
import {defineTable} from '@getstrata/core/database/table';
import {PersistenceError} from '@getstrata/core/database/errors';
import {bootstrapApp} from './src/bootstrap/createApp.ts';
import {Note} from './src/models/Note.ts';
assert.equal(process.env.MIGRATION_DATABASE_URL??'','');
const tenants=defineRepository({name:'FixtureGuestTenants',table:defineTable<{id:number;slug:string},'id'>({name:'tenant',primaryKey:'id',columns:['id','slug']}),dependencies:[],create:binding=>new BaseRepository(binding)});
const users=defineRepository({name:'FixtureAbsentUsers',table:defineTable<{id:number},'id'>({name:'users',primaryKey:'id',columns:['id']}),dependencies:[],create:binding=>new BaseRepository(binding)});
const envelope={kind:'command' as const,actor:{kind:'system' as const,policy:'fixture.guest-tenancy'}};
function missingUsers(error:unknown):boolean{
 if(error instanceof PersistenceError)return error.code==='DATABASE_OPERATION_FAILED'&&missingUsers(error.cause);
 if(error instanceof AggregateError)return error.errors.length>0&&error.errors.every(missingUsers);
 if(!(error instanceof Error))return false;
 const code=Reflect.get(error,'code')${database === "postgres" ? ",errno=Reflect.get(error,'errno')" : ""};
 return ${database === "sqlite" ? "code==='SQLITE_ERROR'&&error.message.includes('no such table: users')" : database === "mysql" ? "code==='ER_NO_SUCH_TABLE'&&error.message.includes('.users')" : "(errno==='42P01'||code==='42P01')&&error.message.includes('relation \"users\" does not exist')"};
}
let owner:Application|undefined;const errors:unknown[]=[];
try{
 const app=await bootstrapApp({migrate:false,mode:'command',persistence:{repositories:[tenants,users]},onConstructed:application=>{owner=application;return undefined;}});
 const other=await app.invoke(envelope,async({database})=>{
  const tenant=await database.repository(tenants).create({slug:'guest-other'});assert.equal(Number(tenant.id),2);return tenant;
 });
 // A new trusted command establishes the tenant before its matching scoped policy runs.
 await app.invoke({...envelope,tenant:{id:other.id,slug:other.slug}},async({database${tenancy === "rls" ? ",policy" : ""}})=>{
  const create=async(selected:SelectedSession)=>{
   const note=await selected.model(Note).create({body:'other-tenant-note',tenant_id:other.id});
   assert.equal(note.get('tenant_id'),2);
   const notes=await selected.model(Note).where({tenant_id:other.id}).get();
   assert.deepEqual(notes.map(note=>note.get('body')),['other-tenant-note']);
  };
  await ${tenancy === "rls" ? "policy.run(database,{kind:'tenant',tenantId:other.id},create)" : "create(database)"};
 });
 // Bootstrap succeeds first; only this separate command invocation may fail for native absence.
 await assert.rejects(()=>app.invoke(envelope,({database})=>database.repository(users).count()),missingUsers,'Header apps must not contain a fake users table');
 await app.invoke(envelope,async({database})=>{const other=await database.repository(tenants).findById(2);assert.equal(other?.slug,'guest-other');});
}catch(error){errors.push(error);}
if(owner)try{const stopped=await owner.stop({reason:'Guest tenancy data probe complete'});if(!stopped.successful)throw new Error('Guest tenancy data owner did not stop cleanly',{cause:stopped});}catch(error){errors.push(error);}
if(errors.length===1)throw errors[0];if(errors.length>1)throw new AggregateError(errors,'Guest tenancy data probe and cleanup failed.');
`,
  );
  await run(["other-tenant.ts"]);
  await start();
  await request({}, 401);
  const headers = {
    "x-authenticated-user-id": "42",
    "x-authenticated-user-role": "admin",
    "x-tenant-id": "2",
  };
  const first = (await (await request(headers)).json()) as {
    userId: string;
    source: string;
    tenantId: number;
    notes: { tenant_id: number; body: string }[];
  };
  assert.equal(String(first.userId), "42");
  assert.equal(first.source, "guest");
  assert.equal(first.tenantId, 1);
  assert.equal(first.notes.length, 1);
  assert.ok(first.notes.every((note) => note.tenant_id === 1 && note.body !== "other-tenant-note"));
  const created = await http(`${origin}/api/v1/guest-notes`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ body: "own-tenant-write", tenant_id: 2 }),
  });
  assert.equal(created.status, 201, await created.clone().text());
  const written = (await created.json()) as { body: string; tenant_id: number };
  assert.equal(written.body, "own-tenant-write");
  assert.equal(
    written.tenant_id,
    1,
    "Submitted tenant fields must not override the framework scope",
  );
  const unauthenticated = await http(`${origin}/api/v1/guest-notes`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-credential-source": "guest" },
    body: JSON.stringify({ body: "forged" }),
  });
  assert.equal(
    unauthenticated.status,
    403,
    "An arbitrary source header cannot bypass anonymous CSRF/auth",
  );
  const preflight = await http(`${origin}/api/v1/guest-notes`, {
    method: "OPTIONS",
    headers: {
      origin: "https://untrusted.example.test",
      "access-control-request-method": "POST",
      "access-control-request-headers": "x-authenticated-user-id,content-type",
    },
  });
  assert.equal(
    preflight.headers.get("access-control-allow-origin"),
    null,
    "Untrusted browser origins cannot send identity headers",
  );
  await stopServer();
  env.TENANT_DEV_HEADERS = "true";
  await start();
  const selected = (await (await request(headers)).json()) as {
    tenantId: number;
    notes: { tenant_id: number; body: string }[];
  };
  assert.equal(selected.tenantId, 2);
  assert.deepEqual(
    selected.notes.map((note) => note.body),
    ["other-tenant-note"],
  );
  await stopServer();
  env.AUTH_DEV_HEADERS = "false";
  await start();
  await request(headers, 401);
  checkInterrupted();
} catch (error) {
  failures.push(error);
  if (server) console.error(`${serverOutput}\n${serverError}`);
} finally {
  // Every short child has joined; stop the last immutable HTTP owner before the fixture.
  try {
    await stopServer();
  } catch (error) {
    failures.push(error);
  }
  if (reservation)
    try {
      await reservation.stop(true);
    } catch (error) {
      failures.push(error);
    }
  try {
    await fixture.close();
  } catch (error) {
    failures.push(error);
  }
  if (terminationTimer) clearTimeout(terminationTimer);
  if (interrupted) failures.push(interruption);
  process.removeListener("SIGTERM", terminate);
}
throwFailures(failures, "Installed guest tenancy verification and cleanup failed.");
console.log(
  `PASS ${database}/${tenancy}: local official CLI boots; no users table; account-free identity, explicit tenant predicates and writes, captured header policy, disabled-header refusal and confirmed shutdown`,
);
