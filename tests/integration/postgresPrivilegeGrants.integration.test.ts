import { expect, test } from "bun:test";
import {
  ensurePostgresAppRole,
  grantPostgresAppRolePrivileges,
} from "@getstrata/core/tenant/enableTenantRls";
import { SQL } from "bun";
import { type PostgresSql, quoteSqlLiteral } from "../../src/core/tenant/postgresAppRole";

const adminUrl = process.env.MIGRATION_DATABASE_URL;
test.skipIf(!adminUrl)(
  "real cooperative privilege grants serialize and roll back without role-admin rights",
  async () => {
    if (!adminUrl) throw new Error("Dedicated administrative test URL required.");
    const id = crypto.randomUUID().replaceAll("-", "");
    const database = `grant_db_${id}`,
      ownerRole = `grant_owner_${id}`,
      appRole = `grant_app_${id}`;
    const password = crypto.randomUUID();
    const control = new SQL({ url: adminUrl, max: 1 });
    const createdRoles: string[] = [];
    let created = false;
    const clients: SQL[] = [];
    try {
      await control.unsafe(
        `CREATE ROLE ${ownerRole} LOGIN PASSWORD ${quoteSqlLiteral(password)} NOSUPERUSER NOCREATEROLE NOBYPASSRLS`,
      );
      createdRoles.push(ownerRole);
      await control.unsafe(`CREATE ROLE ${appRole} NOSUPERUSER NOCREATEROLE NOBYPASSRLS`);
      createdRoles.push(appRole);
      await control.unsafe(`CREATE DATABASE ${database} OWNER ${ownerRole}`);
      created = true;
      const target = new URL(adminUrl);
      target.pathname = `/${database}`;
      const admin = new SQL({ url: target.href, max: 1 });
      clients.push(admin);
      target.username = ownerRole;
      target.password = password;
      const delegated = Array.from({ length: 8 }, () => new SQL({ url: target.href, max: 1 }));
      clients.push(...delegated);
      const real = delegated[0];
      if (!real) throw new Error("A delegated test connection is required.");
      await real.unsafe(
        "CREATE TABLE fixture (id SERIAL PRIMARY KEY, value TEXT); CREATE FUNCTION fixture_fn() RETURNS int LANGUAGE SQL AS 'SELECT 1'",
      );
      const [rights] = await real.unsafe<
        { rolsuper: boolean; rolcreaterole: boolean; rolbypassrls: boolean }[]
      >("SELECT rolsuper,rolcreaterole,rolbypassrls FROM pg_roles WHERE rolname=current_user");
      expect(rights).toEqual({ rolsuper: false, rolcreaterole: false, rolbypassrls: false });
      // A grant-only owner must not need the superuser catalog lock used by role creation.
      await expect(
        real.begin(async (tx) => {
          await tx.unsafe("LOCK TABLE pg_catalog.pg_authid IN SHARE ROW EXCLUSIVE MODE");
        }),
      ).rejects.toThrow();
      for (const client of clients) await client.unsafe("SET statement_timeout='5s'");
      for (let round = 0; round < 3; round++) {
        const results = await Promise.allSettled(
          delegated.map((sql) => grantPostgresAppRolePrivileges(sql, { database, role: appRole })),
        );
        expect(results.every((result) => result.status === "fulfilled")).toBe(true);
      }
      // Full provisioning and post-migration grants must use the same database lock order.
      const mixed = await Promise.allSettled([
        ensurePostgresAppRole(admin, { database, role: appRole, password }),
        ...delegated.map((sql) => grantPostgresAppRolePrivileges(sql, { database, role: appRole })),
      ]);
      expect(mixed.every((result) => result.status === "fulfilled")).toBe(true);
      await real.unsafe(
        `REVOKE CONNECT ON DATABASE ${database} FROM PUBLIC; REVOKE CONNECT ON DATABASE ${database} FROM ${appRole}`,
      );
      const canConnect = async () => {
        const [row] = await admin.unsafe<{ allowed: boolean }[]>(
          "SELECT has_database_privilege($1,$2,'CONNECT') AS allowed",
          [appRole, database],
        );
        return row?.allowed;
      };
      expect(await canConnect()).toBe(false);
      const fault: PostgresSql = {
        async unsafe<T>(query: string, params?: readonly unknown[]) {
          // Independent injected late SQL failure: old separate statements already committed CONNECT.
          const text = query.includes("ALTER DEFAULT PRIVILEGES") ? `${query}; SELECT 1/0` : query;
          return await real.unsafe<T[]>(text, params ? [...params] : []);
        },
      };
      await expect(
        grantPostgresAppRolePrivileges(fault, { database, role: appRole }),
      ).rejects.toThrow();
      expect(await canConnect()).toBe(false);
      await grantPostgresAppRolePrivileges(real, { database, role: appRole });
      expect(await canConnect()).toBe(true);
      // Verify existing and future objects using the granted restricted login itself.
      await real.unsafe("CREATE TABLE future_fixture (id SERIAL PRIMARY KEY)");
      const appUrl = new URL(target.href);
      appUrl.username = appRole;
      const app = new SQL({ url: appUrl.href, max: 1 });
      clients.push(app);
      await app.unsafe(
        "INSERT INTO fixture(value) VALUES ('existing'); INSERT INTO future_fixture DEFAULT VALUES",
      );
      const [fn] = await app.unsafe<{ value: number }[]>("SELECT fixture_fn() AS value");
      expect(fn?.value).toBe(1);
      const [role] = await app.unsafe<{ rolsuper: boolean; rolbypassrls: boolean }[]>(
        "SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user",
      );
      expect(role).toEqual({ rolsuper: false, rolbypassrls: false });
    } finally {
      await Promise.allSettled(clients.map((client) => client.close()));
      if (created) await control.unsafe(`DROP DATABASE ${database} WITH (FORCE)`);
      for (const role of createdRoles.reverse()) await control.unsafe(`DROP ROLE ${role}`);
      await control.close();
    }
  },
  30000,
);
