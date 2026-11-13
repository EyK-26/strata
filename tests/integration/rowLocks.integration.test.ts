import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { BaseRepository } from "@getstrata/core/database/baseRepository";
import { defineRepository } from "@getstrata/core/database/definitions";
import { defineModel, Model } from "@getstrata/core/database/model";
import type { TransactionSession } from "@getstrata/core/database/session";
import { defineTable } from "@getstrata/core/database/table";
import { SQL } from "bun";
import { createNativePersistenceApplication } from "../helpers/nativePersistenceApplication";

const url = process.env.RLS_TEST_DATABASE_URL ?? process.env.APP_DATABASE_URL;
const adminUrl = process.env.MIGRATION_DATABASE_URL;
const name = `lock_probe_${crypto.randomUUID().replaceAll("-", "")}`;
const table = defineTable<{ id: number; tenant_id: number; stock: number }, "id">({
  name,
  primaryKey: "id",
  columns: ["id", "tenant_id", "stock"],
});
class StockModel extends Model<{ id: number; tenant_id: number; stock: number }, "id"> {}
const repositoryDefinition = defineRepository({
  name: "stock.repository",
  table,
  dependencies: [] as const,
  create: (binding) => new BaseRepository(binding),
});
const stockDefinition = defineModel({
  name: "Stock",
  repository: repositoryDefinition,
  dependencies: [] as const,
  attributes: { timestamps: false, fillable: ["stock"] },
  construct: (state, binding) => new StockModel(state, binding),
});
function boundStock(transaction: TransactionSession) {
  return transaction.model(stockDefinition);
}

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
describe.skipIf(!url || !adminUrl)("Postgres typed row locks under restricted-role RLS", () => {
  let owner: SQL;
  let native: Awaited<ReturnType<typeof createNativePersistenceApplication>>;
  beforeAll(async () => {
    owner = new SQL(adminUrl!);
    native = await createNativePersistenceApplication({
      default: "test",
      connections: { test: { driver: "pgsql", url: url!, max: 5 } },
      repositories: [repositoryDefinition],
      models: [stockDefinition],
    });
    const [role] = await native.run((database) =>
      database.execute<{ rolsuper: boolean; rolbypassrls: boolean }>({
        text: "SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user",
        params: [],
      }),
    );
    expect(role!.rolsuper || role!.rolbypassrls).toBe(false);
    await owner.unsafe(
      `CREATE TABLE ${name} (id INTEGER NOT NULL,tenant_id INTEGER NOT NULL,stock INTEGER NOT NULL,PRIMARY KEY (id,tenant_id)); ALTER TABLE ${name} ENABLE ROW LEVEL SECURITY; ALTER TABLE ${name} FORCE ROW LEVEL SECURITY; CREATE POLICY tenant_scope ON ${name} USING (tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::integer) WITH CHECK (tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::integer); GRANT SELECT,UPDATE ON ${name} TO strata_app; INSERT INTO ${name} VALUES (1,1,10),(1,2,20)`,
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
  const scope = <T>(
    id: number,
    work: (Stock: ReturnType<typeof boundStock>, transaction: TransactionSession) => Promise<T>,
  ) => native.tenant(id, (transaction) => work(boundStock(transaction), transaction));
  test("competing buyers serialize and observe committed stock; other tenants remain independent", async () => {
    const entered = gate();
    const finish = gate();
    const first = scope(1, async (Stock, _transaction) => {
      const row = await Stock.query().where({ id: 1 }).lockForUpdate().first();
      entered.release();
      await finish.promise;
      await row!.update({ stock: row!.get("stock") - 1 });
    });
    await entered.promise;
    let admitted = false;
    const second = scope(1, async (Stock, _transaction) => {
      const row = await Stock.query().where({ id: 1 }).lockForUpdate().select("stock").first();
      admitted = true;
      expect(row!.stock).toBe(9);
    });
    try {
      await Bun.sleep(30);
      expect(admitted).toBe(false);
      await scope(2, async (Stock, _transaction) => {
        expect(
          (await Stock.query().where({ id: 1 }).lockForUpdate().select("stock").first())!.stock,
        ).toBe(20);
      });
    } finally {
      finish.release();
    }
    await Promise.all([first, second]);
  });
  test("SKIP LOCKED returns no row and savepoint failure does not release the outer lock", async () => {
    const entered = gate();
    const finish = gate();
    const first = scope(1, async (Stock, transaction) => {
      await Stock.query().lockForUpdate().first();
      await expect(
        transaction.transaction(async (child) => {
          const Stock = boundStock(child);
          await Stock.query().sharedLock().first();
          throw new Error("savepoint failure");
        }),
      ).rejects.toThrow("savepoint failure");
      entered.release();
      await finish.promise;
    });
    await entered.promise;
    try {
      await scope(1, async (Stock, _transaction) => {
        expect(await Stock.query().lockForUpdate({ wait: "skipLocked" }).first()).toBeNull();
      });
    } finally {
      finish.release();
    }
    await first;
    await scope(1, async (Stock, _transaction) => {
      expect(await Stock.query().lockForUpdate({ wait: "nowait" }).first()).not.toBeNull();
    });
  });
  test("NOWAIT fails while exclusive owner holds the row", async () => {
    const entered = gate();
    const finish = gate();
    const first = scope(1, async (Stock, _transaction) => {
      await Stock.query().lockForUpdate().first();
      entered.release();
      await finish.promise;
    });
    await entered.promise;
    try {
      await expect(
        scope(1, (Stock, _transaction) => Stock.query().sharedLock({ wait: "nowait" }).first()),
      ).rejects.toThrow();
    } finally {
      finish.release();
    }
    await first;
  });
});

describe.skipIf(!process.env.MYSQL_URL)("MySQL 8 typed row locks", () => {
  let native: Awaited<ReturnType<typeof createNativePersistenceApplication>>;
  beforeAll(async () => {
    native = await createNativePersistenceApplication({
      default: "test",
      connections: { test: { driver: "mysql", url: process.env.MYSQL_URL! } },
      repositories: [repositoryDefinition],
      models: [stockDefinition],
    });
    await native.run(async (database) => {
      await database.execute({
        text: `CREATE TABLE ${name} (id INTEGER PRIMARY KEY,tenant_id INTEGER NOT NULL,stock INTEGER NOT NULL)`,
        params: [],
      });
      await database.execute({ text: `INSERT INTO ${name} VALUES (1,1,10)`, params: [] });
    });
  });
  afterAll(async () => {
    try {
      await native?.run((database) =>
        database.execute({ text: `DROP TABLE IF EXISTS ${name}`, params: [] }),
      );
    } finally {
      await native?.close();
    }
  });
  test("exclusive/shared clauses and SKIP LOCKED/NOWAIT execute on the actual driver", async () => {
    const entered = gate();
    const finish = gate();
    const scope = <T>(
      work: (Stock: ReturnType<typeof boundStock>, transaction: TransactionSession) => Promise<T>,
    ) =>
      native.run((database) =>
        database.transaction((transaction) => work(boundStock(transaction), transaction)),
      );
    const holder = scope(async (Stock, _transaction) => {
      await Stock.query().where({ id: 1 }).lockForUpdate().first();
      entered.release();
      await finish.promise;
    });
    await entered.promise;
    try {
      await scope(async (Stock, _transaction) => {
        expect(
          await Stock.query().where({ id: 1 }).lockForUpdate({ wait: "skipLocked" }).first(),
        ).toBeNull();
      });
      await expect(
        scope((Stock, _transaction) =>
          Stock.query().where({ id: 1 }).sharedLock({ wait: "nowait" }).first(),
        ),
      ).rejects.toThrow();
    } finally {
      finish.release();
    }
    await holder;
    await scope(async (Stock, _transaction) => {
      expect((await Stock.query().sharedLock().select("stock").first())!.stock).toBe(10);
    });
  });
});
