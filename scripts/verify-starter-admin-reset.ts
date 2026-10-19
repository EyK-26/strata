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
  MIGRATION_DATABASE_URL: fixture.migrationUrl,
  TENANCY_DRIVER: tenancy,
  OTEL_SDK_DISABLED: "true",
};
await writeFile(
  join(fixture.app, ".env"),
  await readFile(join(fixture.app, ".env.example"), "utf8"),
);
const cli = join(fixture.app, "node_modules/@getstrata/cli/cli.ts");
async function run(
  args: string[],
  options: { input?: string; admin?: boolean; mode?: string } = {},
) {
  const child = Bun.spawn([process.execPath, ...args], {
    cwd: fixture.app,
    env: {
      ...env,
      ...(options.admin
        ? { DATABASE_URL: fixture.migrationUrl, APP_DATABASE_URL: fixture.migrationUrl }
        : {}),
      ...(options.mode ? { APP_ENV: options.mode } : {}),
    },
    stdin: options.input ? new TextEncoder().encode(options.input) : "ignore",
    stdout: "pipe",
    stderr: "pipe",
    timeout: 60000,
  });
  const [code, out, err] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { code, output: out + err };
}
async function successful(args: string[], options: Parameters<typeof run>[1] = {}) {
  const result = await run(args, options);
  assert.equal(result.code, 0, result.output);
  return result.output;
}
const setup = `import {getSql,closeDatabase} from './src/bootstrap/database.ts';getSql();import {BaseRepository} from '@getstrata/core/database/baseRepository';import {defineTable} from '@getstrata/core/database/table';import {runWithMigrationBypass} from '@getstrata/core/tenant/databaseTenantContext';import {User} from './src/models/User.ts';const claims=new BaseRepository(defineTable({name:'initial_admin_provisioning',primaryKey:'id',columns:['id','email','provisioned_at']}));`;
async function prepareTenant() {
  if (tenancy !== "none")
    await successful([
      "-e",
      `${setup}const tenants=new BaseRepository(defineTable({name:'tenant',primaryKey:'id',columns:['id','slug']}));await tenants.create({slug:'owned-test'});await closeDatabase();`,
    ]);
}
async function counts() {
  return JSON.parse(
    (
      await successful([
        "-e",
        `${setup}const users=await runWithMigrationBypass(()=>User.query().count());console.log(JSON.stringify({users,claims:await claims.count()}));await closeDatabase();`,
      ])
    ).trim(),
  );
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
let cleanupPromise: Promise<void> | undefined;
const cleanup = () => (cleanupPromise ??= fixture.close());
const terminate = () => {
  void cleanup().finally(() => process.exit(143));
};
process.once("SIGTERM", terminate);
try {
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
  const race = await Promise.all([
    provision("race-a@example.test"),
    provision("race-b@example.test"),
  ]);
  assert.equal(
    race.filter((result) => result.code === 0).length,
    1,
    "One concurrent claimant must win.",
  );
  assert.equal(race.filter((result) => result.code !== 0).length, 1);
  assert.deepEqual(await counts(), { users: 1, claims: 1 });
  await successful([cli, "migrate:fresh", "--seed"], { admin: true });
  assert.deepEqual(await counts(), { users: 2, claims: 0 });
  console.log(
    `PASS ${database}/${tenancy}: real admin provisioning, protected rollback, production/staging refusal, explicit local reset and concurrent claim`,
  );
} finally {
  process.removeListener("SIGTERM", terminate);
  await cleanup();
}
