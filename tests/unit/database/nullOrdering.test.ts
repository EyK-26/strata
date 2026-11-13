import { expect, test } from "bun:test";
import { BaseRepository } from "@getstrata/core/database/baseRepository";
import { defineRepository } from "@getstrata/core/database/definitions";
import { defineModel, Model } from "@getstrata/core/database/model";
import { buildSelectQuery } from "@getstrata/core/database/query";
import { dialectFor } from "@getstrata/core/database/sqlDialects";
import { defineTable } from "@getstrata/core/database/table";
import type { QueryOrder } from "@getstrata/core/database/types";
import { withBoundDatabase } from "../../helpers/boundRepositoryHarness";

type Receipt = { id: number; attempted: number | null; received: number };
const table = defineTable<Receipt, "id">({
  name: "null_order_receipts",
  primaryKey: "id",
  columns: ["id", "attempted", "received"],
});
class ReceiptModel extends Model<Receipt, "id"> {}
const repositoryDefinition = defineRepository({
  name: "receipt.repo",
  table,
  dependencies: [] as const,
  create: (binding) => new BaseRepository(binding),
});
const receiptDefinition = defineModel({
  name: "Receipt",
  repository: repositoryDefinition,
  dependencies: [] as const,
  attributes: {},
  construct: (state, binding) => new ReceiptModel(state, binding),
});

for (const driver of ["pgsql", "sqlite", "mysql"] as const) {
  test(`${driver} keeps omitted placement, compiles explicit placement and rejects malformed options`, () =>
    (() => {
      const reference =
        driver === "mysql"
          ? "`null_order_receipts`.`attempted`"
          : '"null_order_receipts"."attempted"';
      expect(
        buildSelectQuery(dialectFor(driver), table, { orderBy: { attempted: "asc" } }).text,
      ).toEndWith(`${reference} ASC`);
      for (const direction of ["ASC", "DESC"] as const)
        for (const nulls of ["first", "last"] as const) {
          const query = buildSelectQuery(dialectFor(driver), table, {
            where: { id: { gt: 0 } },
            orderBy: [{ column: "attempted", direction, nulls }, { column: "id" }],
            limit: 2,
          });
          expect(query.text).toContain(
            driver === "mysql"
              ? `(${reference} IS NULL) ${nulls === "first" ? "DESC" : "ASC"}, ${reference} ${direction}`
              : `${reference} ${direction} NULLS ${nulls.toUpperCase()}`,
          );
          expect(query.text).toEndWith(
            driver === "mysql"
              ? "`null_order_receipts`.`id` ASC LIMIT 2"
              : '"null_order_receipts"."id" ASC LIMIT 2',
          );
          expect(query.params).toEqual([0]);
        }
      for (const nulls of [null, "FIRST", "last; DROP TABLE receipts", 1, {}])
        expect(() =>
          buildSelectQuery(dialectFor(driver), table, {
            orderBy: JSON.parse(JSON.stringify({ column: "attempted", nulls })),
          }),
        ).toThrow("null ordering");
    })());
}

// Database rows deliberately arrive out of order; ties must retain secondary ordering.
const fixtures =
  "INSERT INTO null_order_receipts VALUES (6,20,2),(5,10,1),(4,10,1),(3,NULL,3),(2,NULL,1),(1,NULL,1)";
async function verify(repository: BaseRepository<Receipt, "id">) {
  for (const [direction, nulls, expected] of [
    ["ASC", "first", [1, 2, 3, 4, 5, 6]],
    ["ASC", "last", [4, 5, 6, 1, 2, 3]],
    ["DESC", "first", [1, 2, 3, 6, 4, 5]],
    ["DESC", "last", [6, 4, 5, 1, 2, 3]],
  ] as const) {
    const orderBy: QueryOrder<Receipt>[] = [
      { column: "attempted", direction, nulls },
      { column: "received" },
      { column: "id" },
    ];
    const rows = await repository
      .query()
      .where({ id: { gt: 0 } })
      .orderBy(orderBy)
      .project(["id"]);
    expect(rows.map((row) => row.id)).toEqual([...expected]);
    const page = await repository.findAll({ orderBy, limit: 2 });
    expect(page.map((row) => row.id)).toEqual([...expected.slice(0, 2)]);
  }
}
test("SQLite executes nullable repository ordering with stable ties and limits", async () =>
  withBoundDatabase(
    {
      definition: {
        default: "test",
        connections: { test: { driver: "sqlite", filename: ":memory:" } },
        repositories: [repositoryDefinition],
        models: [receiptDefinition],
      },
    },
    async (database) => {
      await database.execute({
        text: "CREATE TABLE null_order_receipts (id INTEGER PRIMARY KEY, attempted INTEGER, received INTEGER NOT NULL)",
        params: [],
      });
      await database.execute({ text: fixtures, params: [] });
      await verify(database.repository(repositoryDefinition));
      const rows = await database
        .model(receiptDefinition)
        .query()
        .orderBy([
          { column: "attempted", nulls: "first" },
          { column: "received" },
          { column: "id" },
        ])
        .select("id")
        .get();
      expect(rows.map((row) => row.id)).toEqual([1, 2, 3, 4, 5, 6]);
      // Execute MySQL discriminator syntax against native SQLite rows, retaining the original compiler matrix witness.
      for (const [direction, nulls, expected] of [
        ["ASC", "first", [1, 2, 3, 4, 5, 6]],
        ["ASC", "last", [4, 5, 6, 1, 2, 3]],
        ["DESC", "first", [1, 2, 3, 6, 4, 5]],
        ["DESC", "last", [6, 4, 5, 1, 2, 3]],
      ] as const) {
        const orderBy: QueryOrder<Receipt>[] = [
          { column: "attempted", direction, nulls },
          { column: "received" },
          { column: "id" },
        ];
        const all = await database.execute<Receipt>(
          buildSelectQuery(dialectFor("mysql"), table, {
            where: { id: { gt: 0 } },
            orderBy,
            select: [{ kind: "column", table: table.name, column: "id" }],
          }),
        );
        expect(all.map((row) => row.id)).toEqual([...expected]);
        const page = await database.execute<Receipt>(
          buildSelectQuery(dialectFor("mysql"), table, { orderBy, limit: 2 }),
        );
        expect(page.map((row) => row.id)).toEqual([...expected.slice(0, 2)]);
      }
    },
  ));
test("Postgres executes nullable ordering on a transaction-owned connection", async () => {
  const url = process.env.DATABASE_URL;
  if (!url) throw Error("DATABASE_URL is required for the host integration fixture.");
  await withBoundDatabase(
    {
      definition: {
        default: "test",
        connections: { test: { driver: "pgsql", url } },
        repositories: [repositoryDefinition],
        models: [receiptDefinition],
      },
    },
    (database) =>
      database.transaction(async (transaction) => {
        await transaction.execute({
          text: "CREATE TEMP TABLE null_order_receipts (id INTEGER PRIMARY KEY, attempted INTEGER, received INTEGER NOT NULL) ON COMMIT DROP",
          params: [],
        });
        await transaction.execute({ text: fixtures, params: [] });
        await verify(transaction.repository(repositoryDefinition));
      }),
  );
});
