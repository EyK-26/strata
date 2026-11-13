import { expect, test } from "bun:test";
import { SQL } from "bun";
import { fixtureDatabaseUrl } from "../../src/db/fixtureSchemaOwner";

const root = new URL("../../", import.meta.url).pathname;
const runner = `${root}src/db/migrations/runner.ts`;
const seeder = `${root}src/db/seeders/runner.ts`;
const owner = `${root}src/db/fixtureSchemaOwner.ts`;

function child(url: string, code: string, selectedEnv: Record<string, string> = {}) {
  const spawned = Bun.spawn([process.execPath, "--eval", code], {
    cwd: root,
    env: {
      ...Bun.env,
      APP_ENV: "testing",
      DATABASE_URL: url,
      // Deliberately contradictory ambient driver/runtime/admin targets must not redirect ownership.
      APP_DATABASE_URL: "sqlite://:memory:",
      MIGRATION_DATABASE_URL: "sqlite://:memory:",
      DB_CONNECTION: "sqlite",
      SKIP_FIXTURE_TEST_BOOTSTRAP: "1",
      CACHE_DRIVER: "array",
      QUEUE_DRIVER: "sync",
      ...selectedEnv,
    },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  const output = new Response(spawned.stdout).text();
  const errors = new Response(spawned.stderr).text();
  const settled = Promise.allSettled([spawned.exited, output, errors]);
  return {
    process: spawned,
    async finish(success = true) {
      const results = await settled;
      if (results.some((result) => result.status === "rejected"))
        throw new AggregateError(
          results.filter((result) => result.status === "rejected").map((result) => result.reason),
          "Child observation failed",
        );
      const [exit, stdout, stderr] = results.map((result) =>
        result.status === "fulfilled" ? result.value : undefined,
      ) as [number, string, string];
      if (success && exit !== 0) throw new Error(`Fixture child exit ${exit}: ${stderr}`);
      if (!success) expect(exit).not.toBe(0);
      return { exit, stdout, stderr };
    },
  };
}
async function command(
  url: string,
  expression: string,
  success = true,
  selectedEnv: Record<string, string> = {},
) {
  return child(
    url,
    `const m=await import(${JSON.stringify(runner)}); const s=await import(${JSON.stringify(seeder)}); ${expression}`,
    selectedEnv,
  ).finish(success);
}
async function until<T>(read: () => Promise<T>, accepts: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 15000;
  do {
    const value = await read();
    if (accepts(value)) return value;
    await Bun.sleep(20);
  } while (Date.now() < deadline);
  throw new Error("Timed out observing native PostgreSQL ownership");
}

// These source-child tests deliberately avoid shared test-process module mocks and global SQL state.
test("fixture owner rejects non-PostgreSQL targets before acquisition", () => {
  expect(() => fixtureDatabaseUrl({ databaseUrl: "sqlite://:memory:" })).toThrow("PostgreSQL");
  expect(() => fixtureDatabaseUrl({ databaseUrl: "not a URL" })).toThrow("PostgreSQL");
});

test("private PostgreSQL commands retain 38 migrations, 3 seeders, command rollback and restricted RLS", async () => {
  if (!process.env.MIGRATION_DATABASE_URL) throw new Error("MIGRATION_DATABASE_URL required");
  const control = new SQL({ url: process.env.MIGRATION_DATABASE_URL, max: 1 });
  const name = `owned_fixture_${crypto.randomUUID().replaceAll("-", "")}`;
  const decoyName = `${name}_decoy`;
  const role = `owned_fixture_${crypto.randomUUID().replaceAll("-", "")}`;
  const url = new URL(process.env.MIGRATION_DATABASE_URL);
  url.pathname = `/${name}`;
  const decoyUrl = new URL(url);
  decoyUrl.pathname = `/${decoyName}`;
  let decoy: SQL | undefined;
  let decoyCreated = false;
  let db: SQL | undefined;
  let restricted: SQL | undefined;
  let created = false;
  let roleCreated = false;
  const failures: unknown[] = [];
  try {
    await control.unsafe(`CREATE DATABASE ${name}`);
    created = true;
    await control.unsafe(`CREATE DATABASE ${decoyName}`);
    decoyCreated = true;
    decoy = new SQL({ url: decoyUrl.href, max: 1 });
    db = new SQL({ url: url.href, max: 1 });
    const absent = await command(url.href, "await m.getMigrationStatus()", false);
    expect(absent.stderr).toContain("framework_migrations");
    expect(await db.unsafe("SELECT to_regclass('framework_migrations') AS name")).toEqual([
      { name: null },
    ]);
    // Late DDL failure after organization/project creation must undo history and all prior schema.
    await db.unsafe(
      `CREATE FUNCTION fixture_fail_ddl() RETURNS event_trigger LANGUAGE plpgsql AS $$ BEGIN IF EXISTS (SELECT FROM pg_event_trigger_ddl_commands() WHERE object_identity='public.task' AND command_tag='CREATE TABLE') THEN RAISE EXCEPTION 'owned late schema failure'; END IF; END $$`,
    );
    await db.unsafe(
      "CREATE EVENT TRIGGER fixture_fail ON ddl_command_end EXECUTE FUNCTION fixture_fail_ddl()",
    );
    const failed = await command(url.href, "await m.migrateDatabase()", false);
    expect(failed.stderr).toContain("owned late schema failure");
    expect(
      await db.unsafe(
        "SELECT to_regclass('organization') AS organization,to_regclass('framework_migrations') AS history",
      ),
    ).toEqual([{ organization: null, history: null }]);
    await db.unsafe("DROP EVENT TRIGGER fixture_fail");
    await command(
      url.href,
      "await m.migrateDatabase(); const status=await m.getMigrationStatus(); if(status.length!==38||status.some(s=>s.status!=='up')) throw Error('Expected 38 up')",
    );
    expect((await db.unsafe("SELECT count(*)::int AS n FROM framework_migrations"))[0].n).toBe(38);
    await command(
      url.href,
      "process.env.DATABASE_URL=process.env.FIXTURE_DECOY_TARGET; await m.freshDatabase({seed:true,databaseUrl:process.env.FIXTURE_EXPLICIT_TARGET})",
      true,
      { FIXTURE_DECOY_TARGET: decoyUrl.href, FIXTURE_EXPLICIT_TARGET: url.href },
    );
    expect(await decoy.unsafe("SELECT to_regclass('framework_migrations') AS name")).toEqual([
      { name: null },
    ]);
    expect((await db.unsafe("SELECT count(*)::int AS n FROM users"))[0].n).toBe(2);
    expect((await db.unsafe("SELECT count(*)::int AS n FROM organization"))[0].n).toBe(2);
    expect((await db.unsafe("SELECT count(*)::int AS n FROM task"))[0].n).toBe(4);
    expect((await db.unsafe("SELECT count(*)::int AS n FROM notification"))[0].n).toBe(2);
    const users = await db.unsafe("SELECT password_hash FROM users ORDER BY id");
    expect(await Bun.password.verify("password", users[0].password_hash)).toBe(true);
    expect(await Bun.password.verify("password", users[1].password_hash)).toBe(true);
    expect(
      (await db.unsafe("SELECT count(*)::int AS n FROM api_token WHERE token_hash IS NOT NULL"))[0]
        .n,
    ).toBe(2);
    // Failure during fresh restores old schema, old history, and old application rows.
    await db.unsafe("UPDATE organization SET name='Retained before fresh' WHERE id=1");
    await db.unsafe(
      "CREATE EVENT TRIGGER fixture_fail ON ddl_command_end EXECUTE FUNCTION fixture_fail_ddl()",
    );
    expect((await command(url.href, "await m.freshDatabase({seed:true})", false)).stderr).toContain(
      "owned late schema failure",
    );
    expect((await db.unsafe("SELECT name FROM organization WHERE id=1"))[0].name).toBe(
      "Retained before fresh",
    );
    expect((await db.unsafe("SELECT count(*)::int AS n FROM framework_migrations"))[0].n).toBe(38);
    expect((await db.unsafe("SELECT count(*)::int AS n FROM notification"))[0].n).toBe(2);
    await db.unsafe("DROP EVENT TRIGGER fixture_fail");
    // Attach the failure to the NEW notification table during fresh, after all schema work.
    await db.unsafe(
      "CREATE OR REPLACE FUNCTION fixture_fail_seed() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'owned late seed failure'; END $$",
    );
    await db.unsafe(
      `CREATE FUNCTION fixture_attach_seed_failure() RETURNS event_trigger LANGUAGE plpgsql AS $$ BEGIN IF EXISTS (SELECT FROM pg_event_trigger_ddl_commands() WHERE object_identity='public.notification' AND command_tag='CREATE TABLE') THEN EXECUTE 'CREATE TRIGGER fixture_fail_seed BEFORE INSERT ON notification FOR EACH ROW EXECUTE FUNCTION fixture_fail_seed()'; END IF; END $$`,
    );
    await db.unsafe(
      "CREATE EVENT TRIGGER fixture_attach ON ddl_command_end EXECUTE FUNCTION fixture_attach_seed_failure()",
    );
    expect((await command(url.href, "await m.freshDatabase({seed:true})", false)).stderr).toContain(
      "owned late seed failure",
    );
    expect((await db.unsafe("SELECT name FROM organization WHERE id=1"))[0].name).toBe(
      "Retained before fresh",
    );
    expect((await db.unsafe("SELECT count(*)::int AS n FROM framework_migrations"))[0].n).toBe(38);
    expect((await db.unsafe("SELECT count(*)::int AS n FROM users"))[0].n).toBe(2);
    expect((await db.unsafe("SELECT count(*)::int AS n FROM notification"))[0].n).toBe(2);
    await db.unsafe("DROP EVENT TRIGGER fixture_attach");
    // Standalone seed failure occurs after earlier seeders inserted their rows.
    await command(url.href, "await m.freshDatabase()");
    await db.unsafe(
      "CREATE OR REPLACE FUNCTION fixture_fail_seed() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'owned late seed failure'; END $$",
    );
    await db.unsafe(
      "CREATE TRIGGER fixture_fail_seed BEFORE INSERT ON notification FOR EACH ROW EXECUTE FUNCTION fixture_fail_seed()",
    );
    expect((await command(url.href, "await s.seedDatabase()", false)).stderr).toContain(
      "owned late seed failure",
    );
    for (const table of ["organization", "project", "task", "users", "api_token", "notification"])
      expect((await db.unsafe(`SELECT count(*)::int AS n FROM ${table}`))[0].n).toBe(0);
    await db.unsafe("DROP TRIGGER fixture_fail_seed ON notification");
    await command(url.href, "await s.seedDatabase()");
    // Public core semantics are tested elsewhere; this private latest-batch command is atomic.
    await command(
      url.href,
      "await m.rollbackDatabase(); await m.migrateDatabase(); const status=await m.getMigrationStatus(); if(status.length!==38||status.some(s=>s.status!=='up')) throw Error('Expected 38 up')",
    );
    await command(url.href, "await s.seedDatabase()");
    // Successful setval calls leave serials usable; rollback never promises counter restoration.
    expect(
      (
        await db.unsafe(
          "INSERT INTO organization(name,slug,tenant_id) VALUES('Sequence witness','sequence-witness',1) RETURNING id",
        )
      )[0].id,
    ).toBeGreaterThan(2);
    await db.unsafe("DELETE FROM organization WHERE slug='sequence-witness'");
    const rls = await db.unsafe<
      {
        relname: string;
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
      }[]
    >(
      "SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r'",
    );
    for (const table of ["organization", "users", "project", "task", "comment", "notification"])
      expect(rls.find((row) => row.relname === table)).toMatchObject({
        relrowsecurity: true,
        relforcerowsecurity: true,
      });
    for (const table of ["api_token", "organization_member", "sessions"])
      expect(rls.find((row) => row.relname === table)?.relrowsecurity).toBe(false);
    await control.unsafe(
      `CREATE ROLE ${role} LOGIN PASSWORD 'owned-only-test-password' NOSUPERUSER NOBYPASSRLS`,
    );
    roleCreated = true;
    await db.unsafe(`GRANT CONNECT ON DATABASE ${name} TO ${role}`);
    await db.unsafe(`GRANT USAGE ON SCHEMA public TO ${role}`);
    await db.unsafe(`GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO ${role}`);
    const restrictedUrl = new URL(url);
    restrictedUrl.username = role;
    restrictedUrl.password = "owned-only-test-password";
    restricted = new SQL({ url: restrictedUrl.href, max: 1 });
    expect((await restricted.unsafe("SELECT count(*)::int AS n FROM organization"))[0].n).toBe(0);
    await restricted.unsafe("SELECT set_config('app.tenant_id','1',false)");
    expect((await restricted.unsafe("SELECT count(*)::int AS n FROM organization"))[0].n).toBe(2);
    await restricted.unsafe("SELECT set_config('app.tenant_id','2',false)");
    expect((await restricted.unsafe("SELECT count(*)::int AS n FROM organization"))[0].n).toBe(0);
    await expect(
      restricted.unsafe("CREATE TABLE forbidden_schema_change(id int)"),
    ).rejects.toThrow();
  } catch (error) {
    failures.push(error);
  } finally {
    for (const close of [
      () => restricted?.close(),
      () => db?.close(),
      () => decoy?.close(),
      async () => {
        if (created) await control.unsafe(`DROP DATABASE ${name} WITH (FORCE)`);
      },
      async () => {
        if (decoyCreated) await control.unsafe(`DROP DATABASE ${decoyName} WITH (FORCE)`);
      },
      async () => {
        if (roleCreated) await control.unsafe(`DROP ROLE ${role}`);
      },
      async () => {
        expect(
          await control.unsafe("SELECT datname FROM pg_database WHERE datname IN ($1,$2)", [
            name,
            decoyName,
          ]),
        ).toEqual([]);
        expect(
          await control.unsafe("SELECT rolname FROM pg_roles WHERE rolname=$1", [role]),
        ).toEqual([]);
      },
      () => control.close(),
    ]) {
      try {
        await close();
      } catch (error) {
        failures.push(error);
      }
    }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length) throw new AggregateError(failures, "Fixture lifecycle and cleanup failed");
}, 120000);

test("two real fixture processes contend on the selected transaction advisory lock and retain their own backend", async () => {
  if (!process.env.MIGRATION_DATABASE_URL) throw new Error("MIGRATION_DATABASE_URL required");
  const control = new SQL({ url: process.env.MIGRATION_DATABASE_URL, max: 1 });
  const name = `owned_fixture_lock_${crypto.randomUUID().replaceAll("-", "")}`;
  const url = new URL(process.env.MIGRATION_DATABASE_URL);
  url.pathname = `/${name}`;
  const children: ReturnType<typeof child>[] = [];
  const failures: unknown[] = [];
  let created = false;
  try {
    await control.unsafe(`CREATE DATABASE ${name}`);
    created = true;
    const code = `const {withFixtureSchema}=await import(${JSON.stringify(owner)}); const core=await import(${JSON.stringify(`${root}src/core/database/migrations/runner.ts`)}); const {seedSelectedDatabase}=await import(${JSON.stringify(seeder)}); await withFixtureSchema(async db=>{const pid=(await db.unsafe('SELECT pg_backend_pid() AS pid'))[0].pid; console.log('LOCKED '+pid); for await(const input of Bun.stdin.stream()){break;} await core.migrateDatabase(db,await core.loadMigrationsFromDirectory(${JSON.stringify(`${root}src/db/migrations`)})); const schemaPid=(await db.unsafe('SELECT pg_backend_pid() AS pid'))[0].pid; await seedSelectedDatabase(db);const rows=await db.unsafe('SELECT pg_backend_pid() AS pid,count(*)::int AS n FROM framework_migrations');if(pid!==schemaPid||pid!==rows[0].pid||rows[0].n!==38)throw Error('Pin changed');console.log('PIN '+pid);});`;
    const firstChild = child(url.href, code);
    children.push(firstChild);
    const first = await until(
      () =>
        control.unsafe(
          "SELECT pid FROM pg_locks JOIN pg_stat_activity USING(pid) WHERE datname=$1 AND locktype='advisory' AND objid=42424242 AND granted",
          [name],
        ),
      (rows) => rows.length === 1,
    );
    const secondChild = child(url.href, code);
    children.push(secondChild);
    const waiting = await until(
      () =>
        control.unsafe(
          "SELECT pid,wait_event_type,wait_event,query FROM pg_stat_activity WHERE datname=$1 AND wait_event='advisory'",
          [name],
        ),
      (rows) => rows.length === 1,
    );
    expect(waiting[0].pid).not.toBe(first[0].pid);
    expect(waiting[0].wait_event_type).toBe("Lock");
    expect(waiting[0].query).toContain("pg_advisory_xact_lock");
    expect(
      (
        await control.unsafe(
          "SELECT count(*)::int AS n FROM pg_locks JOIN pg_stat_activity USING(pid) WHERE datname=$1 AND locktype='advisory' AND NOT granted",
          [name],
        )
      )[0].n,
    ).toBe(1);
    firstChild.process.stdin.write("release\n");
    await firstChild.process.stdin.flush();
    const firstResult = await firstChild.finish();
    expect(firstResult.stdout).toContain(`PIN ${first[0].pid}`);
    await until(
      () =>
        control.unsafe(
          "SELECT pid FROM pg_locks JOIN pg_stat_activity USING(pid) WHERE datname=$1 AND locktype='advisory' AND objid=42424242 AND granted",
          [name],
        ),
      (rows) => rows.length === 1 && rows[0].pid === waiting[0].pid,
    );
    secondChild.process.stdin.write("release\n");
    await secondChild.process.stdin.flush();
    expect((await secondChild.finish()).stdout).toContain(`PIN ${waiting[0].pid}`);
  } catch (error) {
    failures.push(error);
  } finally {
    for (const item of children) {
      try {
        if (item.process.exitCode === null) item.process.kill();
      } catch (error) {
        failures.push(error);
      }
    }
    const results = await Promise.allSettled(children.map((item) => item.finish()));
    for (const result of results) if (result.status === "rejected") failures.push(result.reason);
    try {
      if (created) await control.unsafe(`DROP DATABASE ${name} WITH (FORCE)`);
    } catch (error) {
      failures.push(error);
    }
    try {
      expect(
        await control.unsafe("SELECT datname FROM pg_database WHERE datname=$1", [name]),
      ).toEqual([]);
    } catch (error) {
      failures.push(error);
    }
    try {
      await control.close();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length) throw new AggregateError(failures, "Fixture lock and cleanup failed");
}, 120000);
