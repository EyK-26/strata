import { expect, test } from "bun:test";
import { persistConsumedRecoveryHash } from "@getstrata/core/auth/passwordLogin";
import {
  currentSqlDialect,
  resetSqlDialect,
  useSqlDialect,
} from "@getstrata/core/database/dialect";
import type { MigrationDatabase } from "@getstrata/core/database/migrations/types";
import { createMysqlConnection } from "@getstrata/core/database/mysqlConnection";
import { createSqliteConnection } from "@getstrata/core/database/sqliteConnection";
import { SQL } from "bun";

async function verify(db: MigrationDatabase) {
  await db.unsafe("CREATE TABLE users(id INTEGER PRIMARY KEY, mfa_recovery_codes TEXT)");
  const original = JSON.stringify(["used-hash", "keep-hash"]);
  const p = currentSqlDialect().placeholder;
  await db.unsafe(`INSERT INTO users VALUES(1,${p(1)}),(2,${p(2)})`, [original, original]);
  const claims = await Promise.allSettled(
    [1, 2].map(() => persistConsumedRecoveryHash(db, 1, original, "used-hash")),
  );
  expect(claims.filter((x) => x.status === "fulfilled")).toHaveLength(1);
  const denied = claims.find((x) => x.status === "rejected");
  expect(denied?.status === "rejected" ? denied.reason : null).toMatchObject({
    status: 422,
    message: "mfa_invalid",
  });
  await expect(persistConsumedRecoveryHash(db, 1, original, "used-hash")).rejects.toMatchObject({
    status: 422,
  });
  expect(await db.unsafe("SELECT id,mfa_recovery_codes FROM users ORDER BY id")).toEqual([
    { id: 1, mfa_recovery_codes: JSON.stringify(["keep-hash"]) },
    { id: 2, mfa_recovery_codes: original },
  ]);
  await expect(persistConsumedRecoveryHash(db, 1, original, "keep-hash")).rejects.toMatchObject({
    status: 422,
  });
  await persistConsumedRecoveryHash(db, 1, JSON.stringify(["keep-hash"]), "keep-hash");
  expect(await db.unsafe("SELECT mfa_recovery_codes FROM users WHERE id=1")).toEqual([
    { mfa_recovery_codes: "[]" },
  ]);
}
for (const driver of ["sqlite", "pgsql", "mysql"] as const) {
  const source =
    driver === "pgsql"
      ? process.env.MIGRATION_DATABASE_URL
      : process.env.MYSQL_OBSERVABILITY_ADMIN_URL;
  test.skipIf(driver !== "sqlite" && !source)(
    `${driver} recovery-code claim rejects concurrent and stale snapshots without touching another user`,
    async () => {
      useSqlDialect(driver);
      if (driver === "sqlite") {
        const db = createSqliteConnection(":memory:");
        try {
          await verify(db);
        } finally {
          db.close();
          resetSqlDialect();
        }
        return;
      }
      if (!source) throw new Error("Dedicated fixture required");
      const name = `mfa_claim_${crypto.randomUUID().replaceAll("-", "")}`;
      const control = driver === "pgsql" ? new SQL(source) : createMysqlConnection(source);
      let db: typeof control | undefined;
      let created = false;
      try {
        await control.unsafe(`CREATE DATABASE ${name}`);
        created = true;
        const url = new URL(source);
        url.pathname = `/${name}`;
        db = driver === "pgsql" ? new SQL(url.href) : createMysqlConnection(url.href);
        await verify(db);
      } finally {
        await db?.close();
        if (created)
          await control.unsafe(`DROP DATABASE ${name}${driver === "pgsql" ? " WITH (FORCE)" : ""}`);
        await control.close();
        resetSqlDialect();
      }
    },
  );
}

const rlsAdmin = process.env.MIGRATION_DATABASE_URL;
const rlsRuntime = process.env.RLS_TEST_DATABASE_URL ?? process.env.APP_DATABASE_URL;
test.skipIf(!rlsAdmin || !rlsRuntime)(
  "Basic recovery claim uses the authenticated identifier under restricted Postgres RLS",
  async () => {
    if (!rlsAdmin || !rlsRuntime) throw new Error("Dedicated RLS fixtures required");
    const { BasicAuthGuard } = await import("@getstrata/core/auth/basicAuthGuard");
    const { hashPassword } = await import("@getstrata/core/auth/password");
    const { generateRecoveryCodes, hashRecoveryCode } = await import(
      "@getstrata/core/security/recoveryCodes"
    );
    const { CORE_AUTH_USER_DIRECTORY_TOKEN } = await import(
      "@getstrata/core/contracts/serviceTokens"
    );
    const { getDefaultDatabasePool, registerDefaultDatabasePool } = await import(
      "@getstrata/core/database/defaultConnection"
    );
    const { getBoundDatabaseConnection, bindDatabaseConnection, resetBoundDatabaseConnection } =
      await import("@getstrata/core/database/boundConnection");
    const { runWithTenantDatabase } = await import("@getstrata/core/tenant/tenantDatabaseScope");
    const name = `mfa_rls_${crypto.randomUUID().replaceAll("-", "")}`;
    const control = new SQL(rlsAdmin);
    let created = false;
    let admin: SQL | undefined, pool: SQL | undefined;
    const previousPool = getDefaultDatabasePool(),
      previousBound = getBoundDatabaseConnection(),
      before = process.env.TENANCY_DRIVER;
    try {
      await control.unsafe(`CREATE DATABASE ${name}`);
      created = true;
      const a = new URL(rlsAdmin),
        r = new URL(rlsRuntime);
      a.pathname = r.pathname = `/${name}`;
      admin = new SQL(a.href);
      pool = new SQL(r.href);
      const [role] = await pool.unsafe<
        { role: string; rolsuper: boolean; rolbypassrls: boolean }[]
      >(
        "SELECT current_user AS role,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user",
      );
      if (!role || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(role.role))
        throw new Error("Invalid restricted fixture role");
      expect(role.rolsuper).toBe(false);
      expect(role.rolbypassrls).toBe(false);
      await admin.unsafe(`CREATE TABLE users(id INTEGER PRIMARY KEY,tenant_id INTEGER,mfa_recovery_codes TEXT);
      ALTER TABLE users ENABLE ROW LEVEL SECURITY;ALTER TABLE users FORCE ROW LEVEL SECURITY;
      CREATE POLICY scope ON users USING (tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::integer OR id::text=current_setting('app.bypass_identifier',true));
      GRANT SELECT,UPDATE ON users TO "${role.role}"`);
      const [code] = generateRecoveryCodes(1);
      const raw = JSON.stringify([hashRecoveryCode(String(code))]);
      await admin.unsafe("INSERT INTO users VALUES(1,101,$1),(2,102,$2)", [raw, raw]);
      registerDefaultDatabasePool(
        pool as unknown as import("@getstrata/core/database/baseRepository").SqlDatabaseConnection,
      );
      resetBoundDatabaseConnection();
      useSqlDialect("pgsql");
      process.env.TENANCY_DRIVER = "rls";
      const password = await hashPassword("fixture-password");
      const { ServiceContainer } = await import("@getstrata/core/contracts/container");
      const container = new ServiceContainer();
      container.set(CORE_AUTH_USER_DIRECTORY_TOKEN, {
        resolveUserFromToken: async () => null,
        findByIdOrThrow: async (id: number) => ({ id, role: "member" }),
        findByEmail: async () => ({
          id: 1,
          role: "member",
          password,
          mfa_enabled: true,
          mfa_secret: "unused",
          mfa_recovery_codes: raw,
        }),
      });
      const guard = new BasicAuthGuard(container);
      const request = new Request("http://fixture.test", {
        headers: {
          authorization: `Basic ${Buffer.from("fixture:fixture-password").toString("base64")}`,
          "x-mfa-code": String(code),
        },
      });
      const tenant = { id: 102, slug: "neighbor", plan: "free", region: "eu" };
      await runWithTenantDatabase(tenant, async () => {
        expect((await guard.resolve(request))?.id).toBe(1);
        expect(await guard.resolve(request)).toBeNull();
        const visible = await (await import("@getstrata/core/database/defaultConnection"))
          .getDefaultDatabaseQuery()
          .unsafe("SELECT id FROM users");
        expect(visible).toEqual([{ id: 2 }]);
      });
      expect(await admin.unsafe("SELECT id,mfa_recovery_codes FROM users ORDER BY id")).toEqual([
        { id: 1, mfa_recovery_codes: "[]" },
        { id: 2, mfa_recovery_codes: raw },
      ]);
    } finally {
      registerDefaultDatabasePool(previousPool);
      if (previousBound) bindDatabaseConnection(previousBound);
      else resetBoundDatabaseConnection();
      if (before === undefined) delete process.env.TENANCY_DRIVER;
      else process.env.TENANCY_DRIVER = before;
      resetSqlDialect();
      await pool?.close();
      await admin?.close();
      if (created) await control.unsafe(`DROP DATABASE ${name} WITH (FORCE)`);
      await control.close();
    }
  },
);
