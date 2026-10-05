import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { defaultLayers } from "../../packages/strata-starter/src/presets.ts";
import { renderPostgresAppRoleInitSql } from "../../packages/strata-starter/src/renderEnv.ts";
import {
  ensurePostgresAppRole,
  postgresAppRoleSql,
} from "../../src/core/tenant/postgresAppRole.ts";

const adminUrl = process.env.MIGRATION_DATABASE_URL ?? "";

describe.skipIf(!adminUrl)("real Postgres cluster-wide role provisioning", () => {
  const suffix = crypto.randomUUID().replaceAll("-", "");
  const databases = [`strata_role_a_${suffix}`, `strata_role_b_${suffix}`] as const;
  const roles: string[] = [];
  const clients: SQL[] = [];
  let control: SQL;

  function connection(database: string): SQL {
    const url = new URL(adminUrl);
    url.pathname = `/${database}`;
    const sql = new SQL({ url: url.href, max: 1, connectionTimeout: 5 });
    clients.push(sql);
    return sql;
  }
  function options(database: string) {
    const role = `strata_role_${crypto.randomUUID().replaceAll("-", "")}`;
    roles.push(role);
    return { database, role, password: `Fixture-${crypto.randomUUID()}!'` };
  }
  async function assertLogin(database: string, role: string, password: string) {
    const url = new URL(adminUrl);
    url.pathname = `/${database}`;
    url.username = role;
    url.password = password;
    const runtime = new SQL({ url: url.href, max: 1, connectionTimeout: 5 });
    try {
      const [row] = await runtime.unsafe<
        { name: string; rolsuper: boolean; rolbypassrls: boolean }[]
      >(
        "SELECT current_user AS name,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user",
      );
      expect(row?.name).toBe(role);
      expect(row?.rolsuper).toBe(false);
      expect(row?.rolbypassrls).toBe(false);
    } finally {
      await runtime.close();
    }
  }
  async function backendPid(sql: SQL): Promise<number> {
    const [row] = await sql.unsafe<{ pid: number }[]>("SELECT pg_backend_pid() AS pid");
    if (!row) throw new Error("Missing fixture backend PID.");
    return row.pid;
  }
  async function waitForCatalogWaiter(pid: number) {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const [row] = await control.unsafe<{ waiting: boolean }[]>(
        `SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=$1 AND database=0
         AND relation='pg_catalog.pg_authid'::regclass AND mode='ShareRowExclusiveLock' AND NOT granted) AS waiting`,
        [pid],
      );
      if (row?.waiting) return;
      await Bun.sleep(10);
    }
    throw new Error("Provisioner did not wait on the shared role catalog.");
  }

  beforeAll(async () => {
    control = new SQL(adminUrl);
    for (const database of databases) await control.unsafe(`CREATE DATABASE ${database}`);
  });
  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.close({ timeout: 1 })));
  });
  afterAll(async () => {
    // Remove only fixture objects, including default ACL dependencies in both databases.
    for (const database of databases) {
      const cleanup = new SQL({
        url: (() => {
          const url = new URL(adminUrl);
          url.pathname = `/${database}`;
          return url.href;
        })(),
        max: 1,
      });
      try {
        for (const role of roles) {
          const [exists] = await cleanup.unsafe("SELECT 1 FROM pg_roles WHERE rolname=$1", [role]);
          if (exists) await cleanup.unsafe(`DROP OWNED BY ${role}`);
        }
      } finally {
        await cleanup.close();
      }
    }
    for (const database of databases)
      await control.unsafe(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
    for (const role of roles) await control.unsafe(`DROP ROLE IF EXISTS ${role}`);
    await control.close();
  });

  test("concurrent first creation across databases and same-database grants succeed", async () => {
    const config = options(databases[0]);
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, (_, index) => {
        const database = index % 2 === 0 ? databases[0] : databases[1];
        return ensurePostgresAppRole(connection(database), { ...config, database });
      }),
    );
    expect(results.map((result) => result.status)).toEqual(Array(4).fill("fulfilled"));
    for (const database of databases) await assertLogin(database, config.role, config.password);
  }, 15_000);

  test("existing-role updates wait for commit across databases and apply explicit credentials", async () => {
    const config = options(databases[0]);
    const left = connection(databases[0]);
    const right = connection(databases[1]);
    await ensurePostgresAppRole(left, config);
    const rotated = `Rotated-${crypto.randomUUID()}!'`;
    let release!: () => void;
    let acquired!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      acquired = resolve;
    });
    const pid = await backendPid(right);
    const first = left.begin(async (transaction) => {
      await ensurePostgresAppRole(transaction, { ...config, password: rotated });
      acquired();
      await held;
    });
    await ready;
    const second = ensurePostgresAppRole(right, {
      ...config,
      database: databases[1],
      password: rotated,
    });
    const settled = Promise.allSettled([first, second]);
    try {
      await waitForCatalogWaiter(pid);
    } finally {
      release();
    }
    expect((await settled).map((result) => result.status)).toEqual(["fulfilled", "fulfilled"]);
    for (const database of databases) await assertLogin(database, config.role, rotated);
  }, 15_000);

  test("transaction rollback releases ownership and reverts credential changes", async () => {
    const config = options(databases[0]);
    const left = connection(databases[0]);
    const right = connection(databases[1]);
    await ensurePostgresAppRole(left, config);
    let release!: () => void, acquired!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      acquired = resolve;
    });
    const pid = await backendPid(right);
    const first = left.begin(async (transaction) => {
      await ensurePostgresAppRole(transaction, { ...config, password: "fixture-rolled-back" });
      acquired();
      await held;
      throw new Error("fixture rollback");
    });
    const firstResult = first.then(
      () => "unexpected commit",
      () => "rolled back",
    );
    await ready;
    const second = ensurePostgresAppRole(right, { ...config, database: databases[1] });
    const secondResult = second.then(
      () => "completed",
      () => "failed",
    );
    try {
      await waitForCatalogWaiter(pid);
    } finally {
      release();
    }
    expect(await firstResult).toBe("rolled back");
    expect(await secondResult).toBe("completed");
    await assertLogin(databases[0], config.role, config.password);
  }, 15_000);

  test("connection loss releases ownership without leaving a provisioning lock", async () => {
    const config = options(databases[0]);
    const left = connection(databases[0]);
    const right = connection(databases[1]);
    await ensurePostgresAppRole(left, config);
    const ownerPid = await backendPid(left);
    const waiterPid = await backendPid(right);
    let release!: () => void, acquired!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      acquired = resolve;
    });
    const first = left.begin(async (transaction) => {
      await ensurePostgresAppRole(transaction, config);
      acquired();
      await held;
    });
    const firstResult = first.then(
      () => "unexpected commit",
      () => "terminated",
    );
    await ready;
    const second = ensurePostgresAppRole(right, { ...config, database: databases[1] });
    const secondResult = second.then(
      () => "completed",
      () => "failed",
    );
    try {
      await waitForCatalogWaiter(waiterPid);
      await control.unsafe("SELECT pg_terminate_backend($1)", [ownerPid]);
    } finally {
      release();
    }
    expect(await firstResult).toBe("terminated");
    expect(await secondResult).toBe("completed");
    await assertLogin(databases[1], config.role, config.password);
  }, 15_000);

  test("starter SQL uses the core mechanism and wraps standalone execution transactionally", () => {
    const script = renderPostgresAppRoleInitSql(databases[0], {
      ...defaultLayers(),
      database: "postgres",
    });
    expect(script).toBe(`BEGIN;\n${postgresAppRoleSql({ database: databases[0] })}COMMIT;\n`);
  });

  test("existing roles lose elevated capabilities while keeping explicit login credentials", async () => {
    const config = options(databases[0]);
    const admin = connection(databases[0]);
    await ensurePostgresAppRole(admin, config);
    await admin.unsafe(`ALTER ROLE ${config.role} SUPERUSER BYPASSRLS CREATEDB CREATEROLE INHERIT`);
    await ensurePostgresAppRole(admin, config);
    const [row] = await admin.unsafe<
      {
        rolsuper: boolean;
        rolbypassrls: boolean;
        rolcreatedb: boolean;
        rolcreaterole: boolean;
        rolinherit: boolean;
      }[]
    >(
      "SELECT rolsuper,rolbypassrls,rolcreatedb,rolcreaterole,rolinherit FROM pg_roles WHERE rolname=$1",
      [config.role],
    );
    expect(row).toEqual({
      rolsuper: false,
      rolbypassrls: false,
      rolcreatedb: false,
      rolcreaterole: false,
      rolinherit: false,
    });
    await assertLogin(databases[0], config.role, config.password);
  });

  test("grant failure rolls back role creation and releases the catalog lock", async () => {
    const config = options(`strata_missing_${suffix}`);
    const admin = connection(databases[0]);
    const failure = await ensurePostgresAppRole(admin, config).then(
      () => null,
      (error: { errno?: string }) => error.errno,
    );
    expect(failure).toBe("3D000");
    expect(
      await admin.unsafe("SELECT 1 FROM pg_roles WHERE rolname=$1", [config.role]),
    ).toHaveLength(0);
    await ensurePostgresAppRole(connection(databases[1]), { ...config, database: databases[1] });
    await assertLogin(databases[1], config.role, config.password);
  });

  test("generated SQL shares the same cluster lock and fails closed without admin privileges", async () => {
    const config = options(databases[0]);
    const results = await Promise.allSettled(
      databases.map((database) =>
        connection(database).unsafe(
          `BEGIN;\n${postgresAppRoleSql({ ...config, database })}COMMIT;\n`,
        ),
      ),
    );
    expect(results.map((result) => result.status)).toEqual(["fulfilled", "fulfilled"]);
    const url = new URL(adminUrl);
    url.pathname = `/${databases[0]}`;
    url.username = config.role;
    url.password = config.password;
    const runtime = new SQL(url.href);
    try {
      const failure = await ensurePostgresAppRole(runtime, config).then(
        () => null,
        (error: { errno?: string }) => error.errno,
      );
      expect(failure).toBe("42501");
    } finally {
      await runtime.close();
    }
    await assertLogin(databases[0], config.role, config.password);
  }, 15_000);
});
