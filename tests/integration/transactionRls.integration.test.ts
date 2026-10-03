import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { SqlDatabaseConnection } from "@getstrata/core/database/baseRepository";
import {
  bindDatabaseConnection,
  getBoundDatabaseConnection,
  resetBoundDatabaseConnection,
} from "@getstrata/core/database/boundConnection";
import {
  getDefaultDatabasePool,
  registerDefaultDatabasePool,
} from "@getstrata/core/database/defaultConnection";
import { repositoryConnection as db } from "@getstrata/core/database/repositoryConnection";
import { runInTransaction } from "@getstrata/core/database/transaction";
import {
  runWithMigrationBypass,
  runWithMigrationBypassForIdentifier,
} from "@getstrata/core/tenant/databaseTenantContext";
import { currentTenantId } from "@getstrata/core/tenant/tenantContext";
import { runWithTenantDatabase } from "@getstrata/core/tenant/tenantDatabaseScope";
import { SQL } from "bun";
import { restoreEnvVar } from "../helpers/restoreEnv";
import { defaultTestTenant } from "../unit/testHelpers";

const rlsUrl = process.env.RLS_TEST_DATABASE_URL ?? process.env.APP_DATABASE_URL;

describe.skipIf(!rlsUrl)("real Postgres transaction/RLS composition", () => {
  let pool: SQL;
  let previousPool: SqlDatabaseConnection;
  let previousBound: ReturnType<typeof getBoundDatabaseConnection>;
  let previousDriver: string | undefined;

  beforeAll(async () => {
    previousPool = getDefaultDatabasePool();
    previousBound = getBoundDatabaseConnection();
    previousDriver = process.env.TENANCY_DRIVER;
    process.env.TENANCY_DRIVER = "rls";
    if (!rlsUrl) throw new Error("A restricted Postgres test URL is required.");
    pool = new SQL({ url: rlsUrl, max: 5 });
    const [role] = await pool.unsafe<{ rolsuper: boolean; rolbypassrls: boolean }[]>(
      "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user",
    );
    expect(role?.rolsuper).toBe(false);
    expect(role?.rolbypassrls).toBe(false);
    registerDefaultDatabasePool(pool as unknown as SqlDatabaseConnection);
    resetBoundDatabaseConnection();
  });

  afterAll(async () => {
    if (previousPool) registerDefaultDatabasePool(previousPool);
    if (previousBound) bindDatabaseConnection(previousBound);
    else resetBoundDatabaseConnection();
    restoreEnvVar("TENANCY_DRIVER", previousDriver);
    await pool?.close();
  });

  async function settings() {
    const [row] = await db.unsafe<{
      tenant: string | null;
      bypass: string | null;
      identifier: string | null;
    }>(`SELECT NULLIF(current_setting('app.tenant_id', true), '') AS tenant,
      NULLIF(current_setting('app.bypass_rls', true), '') AS bypass, NULLIF(current_setting('app.bypass_identifier', true), '') AS identifier`);
    if (!row) throw new Error("Postgres returned no transaction settings.");
    return row;
  }

  test("tenant switching is rejected without changing SQL or async context", async () => {
    await runWithTenantDatabase(defaultTestTenant, async () => {
      await expect(
        runWithTenantDatabase({ ...defaultTestTenant, id: 2 }, async () => undefined),
      ).rejects.toThrow("Cannot switch tenants");
      expect(currentTenantId()).toBe(1);
      expect((await settings()).tenant).toBe("1");
    });
  });

  test("same-tenant nested scopes restore bypass and identifier on success and failure", async () => {
    await runWithMigrationBypass(async () => {
      await runWithMigrationBypassForIdentifier("pinned", async () => {
        const before = await settings();
        await runWithTenantDatabase(defaultTestTenant, async () => {
          expect((await settings()).bypass).toBe("false");
          await runWithTenantDatabase(defaultTestTenant, async () => {
            expect(currentTenantId()).toBe(1);
          });
        });
        expect(await settings()).toEqual(before);
        await expect(
          runWithTenantDatabase(defaultTestTenant, async () => {
            throw new Error("scope failed");
          }),
        ).rejects.toThrow("scope failed");
        expect(await settings()).toEqual(before);
      });
    });
  });

  test("SQL failures roll back to savepoints and restricted-role RLS still applies", async () => {
    await runWithTenantDatabase(defaultTestTenant, async () => {
      await db.unsafe(
        "CREATE TEMP TABLE composition_rls (tenant_id INTEGER, value INTEGER UNIQUE) ON COMMIT DROP",
      );
      await db.unsafe("ALTER TABLE composition_rls ENABLE ROW LEVEL SECURITY");
      await db.unsafe("ALTER TABLE composition_rls FORCE ROW LEVEL SECURITY");
      await db.unsafe(
        "CREATE POLICY composition_scope ON composition_rls USING (tenant_id = current_setting('app.tenant_id')::integer)",
      );
      await db.unsafe("INSERT INTO composition_rls VALUES (1, 1)");
      await expect(
        runInTransaction(async () => {
          await db.unsafe("INSERT INTO composition_rls VALUES (1, 2)");
          await db.unsafe("INSERT INTO composition_rls VALUES (2, 3)");
        }),
      ).rejects.toThrow();
      expect(await db.unsafe("SELECT value FROM composition_rls")).toEqual([{ value: 1 }]);
      await db.unsafe("INSERT INTO composition_rls VALUES (1, 4)");
    });
  });

  test("concurrent root requests retain independent SQL tenant settings", async () => {
    await Promise.all(
      [1, 2, 3].map((id) =>
        runWithTenantDatabase({ ...defaultTestTenant, id }, async () => {
          await db.unsafe("SELECT pg_sleep(0.02)");
          expect(currentTenantId()).toBe(id);
          expect((await settings()).tenant).toBe(String(id));
        }),
      ),
    );
  });
});
