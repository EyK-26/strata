import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { BaseRepository } from "@getstrata/core/database/baseRepository";
import { defineRepository } from "@getstrata/core/database/definitions";
import type { TransactionSession } from "@getstrata/core/database/session";
import { defineTable } from "@getstrata/core/database/table";
import { SQL } from "bun";
import { createNativePersistenceApplication } from "../helpers/nativePersistenceApplication";

const url = process.env.RLS_TEST_DATABASE_URL ?? process.env.APP_DATABASE_URL;
const adminUrl = process.env.MIGRATION_DATABASE_URL;
const name = `write_probe_${crypto.randomUUID().replaceAll("-", "")}`;
const table = defineTable<{ id: number; tenant_id: number; stock: number }, "id">({
  name,
  primaryKey: "id",
  columns: ["id", "tenant_id", "stock"],
});
const repositoryDefinition = defineRepository({
  name: "conditional.stock",
  table,
  dependencies: [] as const,
  create: (binding) => new BaseRepository(binding),
});
const softRepositoryDefinition = defineRepository({
  name: "conditional.soft",
  table: defineTable<
    { id: number; tenant_id: number; stock: number; deleted_at: Date | null },
    "id"
  >({
    name,
    primaryKey: "id",
    columns: ["id", "tenant_id", "stock", "deleted_at"],
    softDeletes: true,
  }),
  dependencies: [] as const,
  create: (binding) => new BaseRepository(binding),
});
function ports(transaction: TransactionSession) {
  return {
    repo: transaction.repository(repositoryDefinition),
    soft: transaction.repository(softRepositoryDefinition),
    transaction,
  };
}
describe.skipIf(!url || !adminUrl)("Postgres conditional writes under restricted-role RLS", () => {
  let owner: SQL;
  let native: Awaited<ReturnType<typeof createNativePersistenceApplication>>;
  beforeAll(async () => {
    owner = new SQL(adminUrl!);
    native = await createNativePersistenceApplication({
      default: "test",
      connections: { test: { driver: "pgsql", url: url!, max: 5 } },
      repositories: [repositoryDefinition, softRepositoryDefinition],
    });
    const [role] = await native.run((database) =>
      database.execute<{ rolsuper: boolean; rolbypassrls: boolean }>({
        text: "SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user",
        params: [],
      }),
    );
    expect(role!.rolsuper || role!.rolbypassrls).toBe(false);
    await owner.unsafe(
      `CREATE TABLE ${name} (id INTEGER NOT NULL,tenant_id INTEGER NOT NULL,stock INTEGER NOT NULL,PRIMARY KEY (id,tenant_id)); ALTER TABLE ${name} ENABLE ROW LEVEL SECURITY; ALTER TABLE ${name} FORCE ROW LEVEL SECURITY; CREATE POLICY tenant_scope ON ${name} USING (tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::integer) WITH CHECK (tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::integer); GRANT SELECT,UPDATE,DELETE ON ${name} TO strata_app; INSERT INTO ${name} VALUES (1,1,10),(1,2,20)`,
    );
  });
  beforeEach(async () => {
    await owner.unsafe(`UPDATE ${name} SET stock=tenant_id*10`);
  });
  afterAll(async () => {
    try {
      await owner?.unsafe(`DROP TABLE IF EXISTS ${name}`);
    } finally {
      await native?.close();
      await owner?.close();
    }
  });
  const scope = <T>(id: number, work: (selected: ReturnType<typeof ports>) => Promise<T>) =>
    native.tenant(id, (transaction) => work(ports(transaction)));
  test("competing conditional buyers admit one writer and enforce RLS", async () => {
    const counts = await Promise.all([
      scope(1, ({ repo }) => repo.query().where({ id: 1, stock: 10 }).update({ stock: 9 })),
      scope(1, ({ repo }) => repo.query().where({ id: 1, stock: 10 }).update({ stock: 9 })),
    ]);
    expect(counts.sort()).toEqual([0, 1]);
    await scope(1, async ({ repo }) => {
      expect(await repo.query().where({ tenant_id: 2 }).update({ stock: 0 })).toBe(0);
      expect(
        await repo.query().where({ id: 1, stock: 9 }).updateReturning({ stock: 8 }, "id", "stock"),
      ).toEqual([{ id: 1, stock: 8 }]);
    });
    await scope(2, async ({ repo }) => expect((await repo.findById(1))?.stock).toBe(20));
  });
  test("a failed transaction rolls back a set-based write", async () => {
    await expect(
      scope(1, async ({ repo }) => {
        expect(await repo.query().where({ id: 1 }).update({ stock: 0 })).toBe(1);
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    await scope(1, async ({ repo }) => expect((await repo.findById(1))?.stock).toBe(10));
  });
});

for (const driver of ["sqlite", "mysql"] as const) {
  describe.skipIf(driver === "mysql" && !process.env.MYSQL_URL)(
    `${driver} conditional writes`,
    () => {
      let native: Awaited<ReturnType<typeof createNativePersistenceApplication>>;
      beforeAll(async () => {
        native = await createNativePersistenceApplication({
          default: "test",
          connections: {
            test:
              driver === "sqlite"
                ? { driver: "sqlite", filename: ":memory:" }
                : { driver: "mysql", url: process.env.MYSQL_URL! },
          },
          repositories: [repositoryDefinition, softRepositoryDefinition],
        });
        await native.run((database) =>
          database.execute({
            text: `CREATE TABLE ${name} (id INTEGER PRIMARY KEY,tenant_id INTEGER NOT NULL,stock INTEGER NOT NULL,deleted_at TIMESTAMP NULL)`,
            params: [],
          }),
        );
      });
      beforeEach(async () =>
        native.run(async (database) => {
          await database.execute({ text: `DELETE FROM ${name}`, params: [] });
          await database.execute({
            text: `INSERT INTO ${name} (id,tenant_id,stock) VALUES(1,1,10),(2,2,20)`,
            params: [],
          });
        }),
      );
      afterAll(async () => {
        try {
          await native?.run((database) =>
            database.execute({ text: `DROP TABLE IF EXISTS ${name}`, params: [] }),
          );
        } finally {
          await native?.close();
        }
      });
      const scope = <T>(work: (selected: ReturnType<typeof ports>) => Promise<T>) =>
        native.run((database) => database.transaction((transaction) => work(ports(transaction))));
      test("bulk soft deletes retain the row and exclude it from later matches", async () => {
        await scope(async ({ soft }) => {
          expect(await soft.query().where({ id: 1 }).delete()).toBe(1);
          expect(await soft.query().where({ id: 1 }).delete()).toBe(0);
          expect(await soft.findById(1)).toBeNull();
          expect((await soft.findAll({ withTrashed: true, where: { id: 1 } })).length).toBe(1);
        });
      });
      test("atomic predicates, affected counts and rollback", async () => {
        await scope(async ({ repo }) => {
          expect(await repo.query().where({ id: 1, stock: 10 }).update({ stock: 9 })).toBe(1);
          expect(await repo.query().where({ id: 1, stock: 10 }).update({ stock: 0 })).toBe(0);
          expect(await repo.query().where({ id: 1, stock: 9 }).update({ stock: 9 })).toBe(1);
          if (driver === "sqlite")
            expect(
              await repo.query().where({ id: 1 }).updateReturning({ stock: 8 }, "stock"),
            ).toEqual([{ stock: 8 }]);
          else
            await expect(
              repo.query().where({ id: 1 }).updateReturning({ stock: 8 }, "stock"),
            ).rejects.toThrow("not supported");
          expect(await repo.query().where({ id: 2 }).delete()).toBe(1);
        });
        await expect(
          scope(async ({ repo }) => {
            await repo.query().where({ id: 1 }).update({ stock: 0 });
            throw new Error("rollback");
          }),
        ).rejects.toThrow("rollback");
        expect(
          (await native.run((database) => database.repository(repositoryDefinition).findById(1)))
            ?.stock,
        ).toBe(driver === "sqlite" ? 8 : 9);
      });
    },
  );
}
