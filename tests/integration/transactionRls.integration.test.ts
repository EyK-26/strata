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
import { bootModels, defineModel } from "@getstrata/core/database/model";
import { repositoryConnection as db } from "@getstrata/core/database/repositoryConnection";
import { defineTable } from "@getstrata/core/database/table";
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
  test("declarative repositories preserve concurrent restricted-role RLS and savepoint rollback", async () => {
    const table = defineTable<{ id: number; tenant_id: number; value: number }, "id">({
      name: "composition_models",
      primaryKey: "id",
      columns: ["id", "tenant_id", "value"],
    });
    class CompositionModel extends defineModel(table) {
      static override $fillable = ["id", "tenant_id", "value"];
      static override $timestamps = false;
    }
    bootModels([CompositionModel]);
    await Promise.all(
      [1, 2, 3].map((id) =>
        runWithTenantDatabase({ ...defaultTestTenant, id }, async () => {
          await db.unsafe(
            "CREATE TEMP TABLE composition_models (id INTEGER PRIMARY KEY, tenant_id INTEGER, value INTEGER) ON COMMIT DROP",
          );
          await db.unsafe("ALTER TABLE composition_models ENABLE ROW LEVEL SECURITY");
          await db.unsafe("ALTER TABLE composition_models FORCE ROW LEVEL SECURITY");
          await db.unsafe(
            "CREATE POLICY composition_model_scope ON composition_models USING (tenant_id = current_setting('app.tenant_id')::integer)",
          );
          await CompositionModel.create({ id: 1, tenant_id: id, value: id });
          await expect(
            runInTransaction(async () => {
              await CompositionModel.create({ id: 2, tenant_id: id, value: 2 });
              await CompositionModel.create({ id: 3, tenant_id: id + 1, value: 3 });
            }),
          ).rejects.toThrow();
          expect(await CompositionModel.find(2)).toBeNull();
          expect((await CompositionModel.findOrFail(1)).get("tenant_id")).toBe(id);
          const projection = CompositionModel.query().select("value");
          expect(await projection.first()).toEqual({ value: id });
          expect(await projection.get()).toEqual([{ value: id }]);
          expect((await settings()).tenant).toBe(String(id));
        }),
      ),
    );
  });
  test("scoped cursor and chunk reads preserve concurrent restricted-role tenancy", async () => {
    type Row = { id: number; tenant_id: number; active: number };
    const table = defineTable<Row, "id">({
      name: "composition_scopes",
      primaryKey: "id",
      columns: ["id", "tenant_id", "active"],
    });
    class Scoped extends defineModel(table) {
      static override $fillable = ["id", "tenant_id", "active"];
      static override $timestamps = false;
      static override boot() {
        Scoped.addGlobalScope<Row, "id">("active", (query) => query.where({ active: 1 }));
      }
    }
    await Promise.all(
      [1, 2, 3].map((id) =>
        runWithTenantDatabase({ ...defaultTestTenant, id }, async () => {
          await db.unsafe(
            "CREATE TEMP TABLE composition_scopes (id INTEGER PRIMARY KEY, tenant_id INTEGER, active INTEGER) ON COMMIT DROP",
          );
          await db.unsafe("ALTER TABLE composition_scopes ENABLE ROW LEVEL SECURITY");
          await db.unsafe("ALTER TABLE composition_scopes FORCE ROW LEVEL SECURITY");
          await db.unsafe(
            "CREATE POLICY scoped_tenant ON composition_scopes USING (tenant_id = current_setting('app.tenant_id')::integer)",
          );
          await Scoped.create({ id: 1, tenant_id: id, active: 1 });
          await Scoped.create({ id: 2, tenant_id: id, active: 0 });
          expect(await Scoped.where({ active: 0 }).get()).toEqual([]);
          expect(
            (await Scoped.query().where({ id: 1 }).orWhere({ id: 2 }).get()).map((row) => row.id),
          ).toEqual([1]);
          expect((await Scoped.cursorPaginate({ perPage: 10 })).data.map((row) => row.id)).toEqual([
            1,
          ]);
          const values: number[] = [];
          await Scoped.chunk(1, async (rows) => {
            values.push(...rows.map((row) => row.get("tenant_id")));
          });
          expect(values).toEqual([id]);
          expect(await Scoped.repository<Row, "id">().count()).toBe(2);
          expect((await settings()).tenant).toBe(String(id));
        }),
      ),
    );
  });
  test("related model scopes preserve concurrent restricted-role connections", async () => {
    type ChildRow = { id: number; tenant_id: number; active: number };
    type ParentRow = { id: number; tenant_id: number; child_id: number };
    const childTable = defineTable<ChildRow, "id">({
      name: "relation_scope_children",
      primaryKey: "id",
      columns: ["id", "tenant_id", "active"],
    });
    const parentTable = defineTable<ParentRow, "id">({
      name: "relation_scope_parents",
      primaryKey: "id",
      columns: ["id", "tenant_id", "child_id"],
    });
    class Child extends defineModel(childTable) {
      static override $fillable = ["id", "tenant_id", "active"];
      static override $timestamps = false;
      static override boot() {
        Child.addGlobalScope<ChildRow, "id">("active", (query) => query.where({ active: 1 }));
      }
    }
    class Parent extends defineModel(parentTable) {
      static override $fillable = ["id", "tenant_id", "child_id"];
      static override $timestamps = false;
      children() {
        return this.hasMany<ChildRow, "id">(Child, "tenant_id");
      }
      child() {
        return this.belongsTo(Child, "child_id");
      }
    }
    await Promise.all(
      [1, 2, 3].map((id) =>
        runWithTenantDatabase({ ...defaultTestTenant, id }, async () => {
          for (const name of ["relation_scope_children", "relation_scope_parents"]) {
            await db.unsafe(
              name === "relation_scope_children"
                ? "CREATE TEMP TABLE relation_scope_children (id INTEGER PRIMARY KEY, tenant_id INTEGER, active INTEGER) ON COMMIT DROP"
                : "CREATE TEMP TABLE relation_scope_parents (id INTEGER PRIMARY KEY, tenant_id INTEGER, child_id INTEGER) ON COMMIT DROP",
            );
            await db.unsafe(`ALTER TABLE ${name} ENABLE ROW LEVEL SECURITY`);
            await db.unsafe(`ALTER TABLE ${name} FORCE ROW LEVEL SECURITY`);
            await db.unsafe(
              `CREATE POLICY relation_scope ON ${name} USING (tenant_id = current_setting('app.tenant_id')::integer)`,
            );
          }
          await Child.create({ id: 1, tenant_id: id, active: 1 });
          await Child.create({ id: 2, tenant_id: id, active: 0 });
          await Parent.create({ id, tenant_id: id, child_id: 2 });
          const parent = await Parent.findOrFail(id);
          expect((await parent.children().get()).map((row) => row.get("tenant_id"))).toEqual([id]);
          expect(await parent.child().get()).toBeNull();
          const loaded = (await Parent.with("children", "child").get())[0];
          expect(loaded?.loaded<Array<{ id: unknown }>>("children")?.map((row) => row.id)).toEqual([
            1,
          ]);
          expect(loaded?.loaded("child")).toBeUndefined();
          expect((await Parent.query().whereHas("children").get()).map((row) => row.id)).toEqual([
            id,
          ]);
          expect(await Parent.query().whereHas("child").get()).toEqual([]);
          expect((await settings()).tenant).toBe(String(id));
        }),
      ),
    );
  });
  test("changed-field writes preserve stale edits, mutable dates and timestamp no-ops under RLS", async () => {
    type Row = {
      id: number;
      tenant_id: number;
      title: string;
      qty: number;
      metadata: { tags: string[] };
      published_at: Date;
      created_at: Date;
      updated_at: Date;
    };
    const table = defineTable<Row, "id">({
      name: "dirty_rls_items",
      primaryKey: "id",
      columns: [
        "id",
        "tenant_id",
        "title",
        "qty",
        "metadata",
        "published_at",
        "created_at",
        "updated_at",
      ],
    });
    class Item extends defineModel(table) {
      static override $guarded = [];
      static override $casts = {
        metadata: "json",
        published_at: "datetime",
        created_at: "datetime",
        updated_at: "datetime",
      } as const;
    }
    await Promise.all(
      [1, 2, 3].map((tenantId) =>
        runWithTenantDatabase({ ...defaultTestTenant, id: tenantId }, async () => {
          await db.unsafe(
            "CREATE TEMP TABLE dirty_rls_items(id INTEGER PRIMARY KEY, tenant_id INTEGER, title TEXT, qty INTEGER, metadata JSONB, published_at TIMESTAMPTZ, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ) ON COMMIT DROP",
          );
          await db.unsafe("ALTER TABLE dirty_rls_items ENABLE ROW LEVEL SECURITY");
          await db.unsafe("ALTER TABLE dirty_rls_items FORCE ROW LEVEL SECURITY");
          await db.unsafe(
            "CREATE POLICY tenant_rows ON dirty_rls_items USING (tenant_id = current_setting('app.tenant_id')::integer)",
          );
          await Item.create({
            id: 1,
            tenant_id: tenantId,
            title: "original",
            qty: 10,
            metadata: { tags: ["a"] },
            published_at: new Date("2026-01-01T00:00:00Z"),
          });
          const first = await Item.findOrFail(1);
          const second = await Item.findOrFail(1);
          await first.update({ title: "changed" });
          second.get("published_at").setUTCFullYear(2027);
          second.get("metadata").tags.push("b");
          await second.update({ qty: 11 });
          const persisted = await Item.findOrFail(1);
          expect(persisted.toObject()).toMatchObject({
            tenant_id: tenantId,
            title: "changed",
            qty: 11,
            metadata: { tags: ["a", "b"] },
          });
          expect(persisted.get("published_at").getUTCFullYear()).toBe(2027);
          const updated = persisted.get("updated_at").getTime();
          await db.unsafe("SELECT pg_sleep(0.005)");
          await persisted.save();
          expect((await Item.findOrFail(1)).get("updated_at").getTime()).toBe(updated);
          await persisted.update({ qty: 12 });
          expect(persisted.get("updated_at").getTime()).toBeGreaterThan(updated);
          expect((await settings()).tenant).toBe(String(tenantId));
        }),
      ),
    );
  });
});
