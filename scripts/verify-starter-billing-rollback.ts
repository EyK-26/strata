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
  MIGRATION_DATABASE_URL: fixture.migrationUrl,
  TENANCY_DRIVER: tenancy,
  OTEL_SDK_DISABLED: "true",
};
await writeFile(
  join(fixture.app, ".env"),
  await readFile(join(fixture.app, ".env.example"), "utf8"),
);
const cli = join(fixture.app, "node_modules/@getstrata/cli/cli.ts");
async function run(args: string[], admin = false) {
  const child = Bun.spawn([process.execPath, ...args], {
    cwd: fixture.app,
    env: {
      ...env,
      ...(admin
        ? { DATABASE_URL: fixture.migrationUrl, APP_DATABASE_URL: fixture.migrationUrl }
        : {}),
    },
    stdout: "pipe",
    stderr: "pipe",
    timeout: 60000,
  });
  const [code, out, err] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  assert.equal(code, 0, out + err);
  return out.trim();
}
const setup = `import assert from 'node:assert/strict';import {getSql,closeDatabase} from './src/bootstrap/database.ts';getSql();import {BaseRepository} from '@getstrata/core/database/baseRepository';import {defineTable} from '@getstrata/core/database/table';const subscriptions=new BaseRepository(defineTable({name:'subscription',primaryKey:'id',columns:['id','plan','status']}));const events=new BaseRepository(defineTable({name:'stripe_webhook_event',primaryKey:'id',columns:['id','event_type']}));const tenants=new BaseRepository(defineTable({name:'tenant',primaryKey:'id',columns:['id','slug','unrelated_marker']}));`;
async function controls() {
  await run([
    "-e",
    `${setup}${tenancy === "none" ? "" : "assert.deepEqual(await tenants.findById(1),{id:1,slug:'owned-tenant',unrelated_marker:'preserve-me'});"}await closeDatabase();`,
  ]);
}
let cleanupPromise: Promise<void> | undefined;
const cleanup = () => (cleanupPromise ??= fixture.close());
const terminate = () => {
  void cleanup().finally(() => process.exit(143));
};
process.once("SIGTERM", terminate);
try {
  const file = `${webhooks ? "0003" : "0002"}_billing_schema.ts`,
    migration = join(fixture.app, "src/db/migrations", file),
    held = join(fixture.app, "pending-billing.ts");
  await rename(migration, held);
  await run([cli, "migrate"], true);
  if (tenancy !== "none")
    await run(
      [
        "-e",
        `${setup}import {Schema} from '@getstrata/core/database/schema';import {withMigrationDatabase} from './src/db/migrationRuntime.ts';await withMigrationDatabase(db=>Schema.run(db,${JSON.stringify(database === "postgres" ? "pgsql" : database)},schema=>schema.table('tenant',table=>{table.text('unrelated_marker').nullable();})));await tenants.create({slug:'owned-tenant',unrelated_marker:'preserve-me'});await closeDatabase();`,
      ],
      true,
    );
  await rename(held, migration);
  await run([cli, "migrate"], true);
  await controls();
  await run([
    "-e",
    `${setup}assert.equal(await subscriptions.count(),0);assert.equal(await events.count(),0);await closeDatabase();`,
  ]);
  const rolledBack = await run(["run", "src/db/rollback.ts"], true);
  assert.ok(rolledBack.includes(file.replace(/\.ts$/, "")));
  await controls();
  await run([
    "-e",
    `${setup}try{await assert.rejects(()=>subscriptions.count());await assert.rejects(()=>events.count());}finally{await closeDatabase();}`,
  ]);
  await run([cli, "migrate"], true);
  await controls();
  await run([cli, "migrate"], true);
  await run(["run", "src/db/rollback.ts"], true);
  await controls();
  await run([cli, "migrate"], true);
  await controls();
  console.log(
    `PASS ${database}/${tenancy}/webhooks=${webhooks}: two later-batch billing rollback/reapply cycles preserve unrelated tenant schema and data`,
  );
} finally {
  process.removeListener("SIGTERM", terminate);
  await cleanup();
}
