import { expect, test } from "bun:test";
import { BaseRepository } from "@getstrata/core/database/baseRepository";
import { defineRepository } from "@getstrata/core/database/definitions";
import { defineTable } from "@getstrata/core/database/table";
import { SQL } from "bun";
import { createNativePersistenceApplication } from "../helpers/nativePersistenceApplication";

type Line = {
  id: number;
  tenant_id: number;
  product_id: number;
  quantity: number | null;
  deleted_at: string | null;
};
const columns = ["id", "tenant_id", "product_id", "quantity", "deleted_at"] as const;
const adminUrl = process.env.MIGRATION_DATABASE_URL;
const restrictedUrl = process.env.RLS_TEST_DATABASE_URL ?? process.env.APP_DATABASE_URL;
test.skipIf(!adminUrl || !restrictedUrl)(
  "Postgres grouped sums retain restricted tenant scope, active transaction and rollback",
  async () => {
    if (!adminUrl || !restrictedUrl) throw Error("Dedicated RLS fixtures required.");
    const name = `grouped_sum_${crypto.randomUUID().replaceAll("-", "")}`;
    const control = new SQL(adminUrl);
    let created = false;
    let admin: SQL | undefined;
    let native: Awaited<ReturnType<typeof createNativePersistenceApplication>> | undefined;
    try {
      await control.unsafe(`CREATE DATABASE ${name}`);
      created = true;
      const a = new URL(adminUrl),
        r = new URL(restrictedUrl);
      a.pathname = r.pathname = `/${name}`;
      admin = new SQL(a.href);
      const repository = defineRepository({
        name: "lines.repository",
        table: defineTable<Line, "id">({
          name: "lines",
          primaryKey: "id",
          columns,
          softDeletes: true,
        }),
        dependencies: [] as const,
        create: (binding) => new BaseRepository(binding),
      });
      native = await createNativePersistenceApplication({
        default: "test",
        connections: { test: { driver: "pgsql", url: r.href } },
        repositories: [repository],
      });
      const [role] = await native.run((database) =>
        database.execute<{ role: string; rolsuper: boolean; rolbypassrls: boolean }>({
          text: "SELECT current_user AS role,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user",
          params: [],
        }),
      );
      if (!role || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(role.role))
        throw Error("Invalid restricted role.");
      expect(role.rolsuper).toBe(false);
      expect(role.rolbypassrls).toBe(false);
      await admin.unsafe(
        `CREATE TABLE lines(id BIGINT PRIMARY KEY,tenant_id INTEGER NOT NULL,product_id INTEGER,quantity BIGINT,deleted_at TIMESTAMP);ALTER TABLE lines ENABLE ROW LEVEL SECURITY;ALTER TABLE lines FORCE ROW LEVEL SECURITY;CREATE POLICY scope ON lines USING(tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::integer);GRANT SELECT,INSERT,UPDATE,DELETE ON lines TO "${role.role}"`,
      );
      await admin.unsafe(
        "INSERT INTO lines VALUES(1,101,11,3,NULL),(2,101,11,4,NULL),(3,102,11,100,NULL),(4,101,11,100,NOW()),(5,101,12,NULL,NULL),(7,101,13,9007199254740992,NULL),(8,101,13,1,NULL)",
      );
      expect(
        await native.tenant(101, (tx) =>
          tx.repository(repository).query().sumBy("product_id", "quantity"),
        ),
      ).toEqual([
        { value: 11, sum: "7" },
        { value: 12, sum: null },
        { value: 13, sum: "9007199254740993" },
      ]);
      expect(
        await native.tenant(102, (tx) =>
          tx.repository(repository).query().sumBy("product_id", "quantity"),
        ),
      ).toEqual([{ value: 11, sum: "100" }]);
      await expect(
        native.tenant(101, async (tx) => {
          await tx.execute({
            text: "INSERT INTO lines VALUES($1,$2,$3,$4,NULL)",
            params: [6, 101, 11, 2],
          });
          expect(
            await tx
              .repository(repository)
              .query()
              .where({ product_id: 11 })
              .sumBy("product_id", "quantity"),
          ).toEqual([{ value: 11, sum: "9" }]);
          throw Error("business rollback");
        }),
      ).rejects.toThrow("business rollback");
      expect(
        await native.tenant(101, (tx) =>
          tx
            .repository(repository)
            .query()
            .where({ product_id: 11 })
            .sumBy("product_id", "quantity"),
        ),
      ).toEqual([{ value: 11, sum: "7" }]);
    } finally {
      await native?.close();
      await admin?.close();
      if (created) await control.unsafe(`DROP DATABASE ${name} WITH (FORCE)`);
      await control.close();
    }
  },
);
test.skipIf(!process.env.MYSQL_URL)(
  "MySQL grouped decimal totals preserve exact text and protected predicates",
  async () => {
    const url = process.env.MYSQL_URL;
    if (!url) throw Error("Dedicated MySQL fixture required.");
    const name = `grouped_sum_${crypto.randomUUID().replaceAll("-", "")}`;
    const repository = defineRepository({
      name: "mysql.lines",
      table: defineTable<Line, "id">({ name, primaryKey: "id", columns }),
      dependencies: [] as const,
      create: (binding) => new BaseRepository(binding),
    });
    const native = await createNativePersistenceApplication({
      default: "test",
      connections: { test: { driver: "mysql", url } },
      repositories: [repository],
    });
    let created = false;
    try {
      await native.run(async (database) => {
        await database.execute({
          text: `CREATE TABLE ${name}(id INTEGER PRIMARY KEY,tenant_id INTEGER,product_id INTEGER,quantity DECIMAL(30,0),deleted_at TIMESTAMP NULL)`,
          params: [],
        });
        created = true;
        await database.execute({
          text: `INSERT INTO ${name} VALUES(1,101,11,3,NULL),(2,101,11,4,NULL),(3,102,11,100,NULL),(4,101,12,NULL,NULL),(5,101,13,9007199254740992,NULL),(6,101,13,1,NULL)`,
          params: [],
        });
        const repo = database.repository(repository);
        expect(
          await repo.query().where({ tenant_id: 101 }).sumBy("product_id", "quantity"),
        ).toEqual([
          { value: 11, sum: "7" },
          { value: 12, sum: null },
          { value: 13, sum: "9007199254740993" },
        ]);
        expect(
          await repo
            .query()
            .where({ tenant_id: 101 })
            .protectWhere()
            .where({ product_id: 11 })
            .orWhere({ tenant_id: 102 })
            .sumBy("product_id", "quantity"),
        ).toEqual([{ value: 11, sum: "7" }]);
        expect(
          await repo.query().where({ tenant_id: 999 }).sumBy("product_id", "quantity"),
        ).toEqual([]);
      });
    } finally {
      try {
        if (created)
          await native.run((database) =>
            database.execute({ text: `DROP TABLE ${name}`, params: [] }),
          );
      } finally {
        await native.close();
      }
    }
  },
);
