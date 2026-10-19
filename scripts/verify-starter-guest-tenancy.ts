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
const reservation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
const port = reservation.port;
await reservation.stop(true);
const origin = `http://127.0.0.1:${port}`;
const env = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(([k]) =>
      ["PATH", "HOME", "TMPDIR", "USER", "SHELL"].includes(k),
    ),
  ),
  APP_ENV: "local",
  PORT: String(port),
  APP_URL: origin,
  DATABASE_URL: fixture.runtimeUrl,
  APP_DATABASE_URL: fixture.runtimeUrl,
  MIGRATION_DATABASE_URL: fixture.migrationUrl,
  TENANCY_DRIVER: tenancy,
  AUTH_DEV_HEADERS: "true",
  TENANT_DEV_HEADERS: "false",
  OTEL_SDK_DISABLED: "true",
};
async function run(args: string[]) {
  const p = Bun.spawn([process.execPath, ...args], {
    cwd: fixture.app,
    env,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 60000,
  });
  const [code, out, err] = await Promise.all([
    p.exited,
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
  ]);
  assert.equal(code, 0, out + err);
}
let server: ReturnType<typeof Bun.spawn> | undefined;
let closed: Promise<void> | undefined;
function cleanup() {
  closed ??= (async () => {
    try {
      if (server) {
        server.kill("SIGTERM");
        await server.exited;
      }
    } finally {
      await fixture.close();
    }
  })();
  return closed;
}
const terminate = () => {
  void cleanup().finally(() => process.exit(143));
};
process.once("SIGTERM", terminate);
const cli = join(fixture.app, "node_modules/@getstrata/cli/cli.ts");
async function start() {
  server = Bun.spawn([process.execPath, cli, "start"], {
    cwd: fixture.app,
    env,
    stdout: Bun.file(join(fixture.app, "server.log")),
    stderr: Bun.file(join(fixture.app, "server.error.log")),
  });
  let ready = false;
  for (let n = 0; n < 100; n++) {
    try {
      if ((await fetch(`${origin}/health`)).ok) {
        ready = true;
        break;
      }
    } catch {}
    await Bun.sleep(100);
  }
  assert.ok(ready, "Generated header application must become ready");
}
async function request(extra: Record<string, string>, status = 200) {
  const response = await fetch(`${origin}/api/v1/guest-notes`, { headers: extra });
  assert.equal(response.status, status, await response.clone().text());
  return response;
}
try {
  await writeFile(
    join(fixture.app, ".env"),
    await readFile(join(fixture.app, ".env.example"), "utf8"),
  );
  assert.equal(
    existsSync(join(fixture.app, "src/models/User.ts")),
    false,
    "Header apps must remain account-free",
  );
  await mkdir(join(fixture.app, "src/modules/guest-notes"));
  await writeFile(
    join(fixture.app, "src/modules/guest-notes/index.ts"),
    `import type {AppModule} from '@getstrata/bootstrap/contracts';
import {currentAuthUser} from '@getstrata/core/auth/authContext';
import {currentTenantId} from '@getstrata/core/tenant/tenantContext';
import {jsonResponse} from '@getstrata/core/http/response';
import {Note} from '../../models/Note.ts';
export default {name:'guest-notes',routes({kernel}){return {'/api/v1/guest-notes':{GET:kernel.wrapApi(async()=>{const tenantId=currentTenantId();const notes=await Note.query().where({tenant_id:tenantId}).get();return jsonResponse({userId:currentAuthUser()?.id,tenantId,notes:notes.map(note=>note.toObject())});})}};}} satisfies AppModule;
`,
  );
  await run(["run", "check"]);
  await run(["run", "db:migrate", "--seed"]);
  await writeFile(
    join(fixture.app, "other-tenant.ts"),
    `import assert from 'node:assert/strict';
import './src/bootstrap/preload.ts';
import {getSql,closeDatabase} from './src/bootstrap/database.ts';
import {BaseRepository} from '@getstrata/core/database/baseRepository';
import {defineTable} from '@getstrata/core/database/table';
import {runWithTenantDatabase} from '@getstrata/core/tenant/tenantDatabaseScope';
getSql();
const {Note}=await import('./src/models/Note.ts');
const tenants=new BaseRepository(defineTable<{id:number;slug:string},'id'>({name:'tenant',primaryKey:'id',columns:['id','slug']}));
const users=new BaseRepository(defineTable<{id:number},'id'>({name:'users',primaryKey:'id',columns:['id']}));
try{const other=await tenants.create({slug:'guest-other'});assert.equal(Number(other.id),2);await runWithTenantDatabase({id:Number(other.id),slug:other.slug},()=>Note.create({body:'other-tenant-note',tenant_id:Number(other.id)}));await assert.rejects(()=>users.query().count(),'Header apps must not contain a fake users table');}finally{await closeDatabase();}
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
    tenantId: number;
    notes: { tenant_id: number; body: string }[];
  };
  assert.equal(String(first.userId), "42");
  assert.equal(first.tenantId, 1);
  assert.equal(first.notes.length, 1);
  assert.ok(first.notes.every((note) => note.tenant_id === 1 && note.body !== "other-tenant-note"));
  assert.ok(server);
  server.kill("SIGTERM");
  await server.exited;
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
  assert.ok(server);
  server.kill("SIGTERM");
  await server.exited;
  env.AUTH_DEV_HEADERS = "false";
  await start();
  await request(headers, 401);
  console.log(
    `PASS ${database}/${tenancy}: no users table; real account-free identity, explicit tenant-header policy, ORM isolation and disabled-header refusal`,
  );
} finally {
  process.removeListener("SIGTERM", terminate);
  await cleanup();
}
