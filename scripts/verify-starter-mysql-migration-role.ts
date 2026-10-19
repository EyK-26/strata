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
async function run(args: string[], expected = 0) {
  const p = Bun.spawn([process.execPath, ...args], {
    cwd: fixture.app,
    env,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 60000,
    killSignal: "SIGTERM",
  });
  const [code, out, err] = await Promise.all([
    p.exited,
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
  ]);
  assert.equal(code, expected, out + err);
  return out + err;
}
let closed: Promise<void> | undefined;
function cleanup() {
  closed ??= fixture.close();
  return closed;
}
const terminate = () => {
  void cleanup().finally(() => process.exit(143));
};
process.once("SIGTERM", terminate);
try {
  await writeFile(
    join(fixture.app, ".env"),
    await readFile(join(fixture.app, ".env.example"), "utf8"),
  );
  await writeFile(
    join(fixture.app, "runtime-probe.ts"),
    `import assert from 'node:assert/strict';
import './src/bootstrap/preload.ts';
import {getSql,closeDatabase} from './src/bootstrap/database.ts';
import {Schema} from '@getstrata/core/database/schema';
import {runWithTenantDatabase} from '@getstrata/core/tenant/tenantDatabaseScope';
getSql();
const {User}=await import('./src/models/User.ts');
try {
 await runWithTenantDatabase({id:1,slug:'default'},async()=>{assert.equal(await User.query().count(),Number(process.argv[2]));});
 await assert.rejects(()=>Schema.run(getSql(),'mysql',schema=>schema.create('runtime_must_not_have_ddl',table=>table.id())), 'Runtime account must remain unable to create tables');
}finally{await closeDatabase();}
`,
  );
  await writeFile(
    join(fixture.app, "privilege-context.ts"),
    `import assert from 'node:assert/strict';
import './src/bootstrap/preload.ts';
import {getSql,closeDatabase} from './src/bootstrap/database.ts';
import {withMigrationDatabase} from './src/db/migrationRuntime.ts';
import {repositoryConnection} from '@getstrata/core/database/repositoryConnection';
import {Schema} from '@getstrata/core/database/schema';
getSql();
try {
 await assert.rejects(()=>withMigrationDatabase(async()=>{
  await Schema.run(repositoryConnection,'mysql',schema=>schema.create('admin_scope_probe',table=>table.id()));
  throw new Error('expected migration callback failure');
 }),/expected migration callback failure/);
 await assert.rejects(()=>Schema.run(repositoryConnection,'mysql',schema=>schema.create('runtime_context_must_stay_limited',table=>table.id())));
}finally{await closeDatabase();}
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
  console.log(
    `PASS mysql/${tenancy}: actual migrate/status/rollback/fresh/reapply and seed; runtime ORM reads work while runtime DDL stays denied`,
  );
} finally {
  process.removeListener("SIGTERM", terminate);
  await cleanup();
}
