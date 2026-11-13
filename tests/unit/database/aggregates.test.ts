import { describe, expect, test } from "bun:test";
import { BaseRepository } from "@getstrata/core/database/baseRepository";
import { defineRepository } from "@getstrata/core/database/definitions";
import { runWithSqlDialect } from "@getstrata/core/database/dialect";
import { defineTable } from "@getstrata/core/database/table";
import type { DatabaseConnection } from "../../../src/core/database/connectionContracts";
import { withRepositories } from "../../helpers/boundRepositoryHarness";

type Order = {
  id: number;
  total: number;
  status: string;
};

const orderTable = defineTable<Order, "id">({
  name: "orders",
  primaryKey: "id",
  columns: ["id", "total", "status"],
});

class FakeConnection implements DatabaseConnection {
  readonly calls: Array<{ query: string; params: readonly unknown[] }> = [];
  private readonly responses: unknown[][] = [];

  queue(rows: unknown[]): void {
    this.responses.push(rows);
  }

  async unsafe<T>(query: string, params: readonly unknown[] = []): Promise<T[]> {
    this.calls.push({ query, params: [...params] });
    return (this.responses.shift() ?? []) as T[];
  }
}

class OrderRepository extends BaseRepository<Order, "id"> {}
const OrderRepositoryDefinition = defineRepository({
  name: "OrderRepository",
  table: orderTable,
  dependencies: [],
  create: (binding) => new OrderRepository(binding),
});

function withRepo(
  work: (fixture: { repo: OrderRepository; connection: FakeConnection }) => Promise<void>,
): Promise<void> {
  const connection = new FakeConnection();
  return withRepositories(connection, [OrderRepositoryDefinition] as const, ([repo]) =>
    work({ repo, connection }),
  );
}

describe("public aggregates", () => {
  test("sum emits SUM and returns a number", async () => {
    await withRepo(async ({ repo, connection }) => {
      connection.queue([{ value: "150.75" }]);

      await runWithSqlDialect("pgsql", async () => {
        expect(await repo.sum("total")).toBe(150.75);
      });

      expect(connection.calls[0]?.query).toContain("SUM");
    });
  });

  test("avg does not round, so money and ratios survive", async () => {
    await withRepo(async ({ repo, connection }) => {
      connection.queue([{ value: "2.4" }]);

      await runWithSqlDialect("pgsql", async () => {
        expect(await repo.avg("total")).toBe(2.4);
      });

      expect(connection.calls[0]?.query).toContain("AVG");
    });
  });

  test("min and max emit their own aggregate", async () => {
    await withRepo(async ({ repo, connection }) => {
      connection.queue([{ value: 1 }]);
      connection.queue([{ value: 99 }]);

      await runWithSqlDialect("pgsql", async () => {
        expect(await repo.min("total")).toBe(1);
        expect(await repo.max("total")).toBe(99);
      });

      expect(connection.calls[0]?.query).toContain("MIN");
      expect(connection.calls[1]?.query).toContain("MAX");
    });
  });

  test("aggregates accept a where filter and bind its parameters", async () => {
    await withRepo(async ({ repo, connection }) => {
      connection.queue([{ value: 10 }]);

      await runWithSqlDialect("pgsql", async () => {
        await repo.sum("total", { status: "paid" });
      });

      expect(connection.calls[0]?.query).toContain("WHERE");
      expect(connection.calls[0]?.params).toEqual(["paid"]);
    });
  });

  test("an empty result set reads as zero rather than NaN", async () => {
    await withRepo(async ({ repo, connection }) => {
      connection.queue([]);

      await runWithSqlDialect("pgsql", async () => {
        expect(await repo.sum("total")).toBe(0);
      });
    });
  });

  test("aggregates quote the column, so identifiers stay safe", async () => {
    await withRepo(async ({ repo, connection }) => {
      connection.queue([{ value: 1 }]);

      await runWithSqlDialect("pgsql", async () => {
        await repo.max("total");
      });

      expect(connection.calls[0]?.query).toContain('"orders"."total"');
    });
  });
});

describe("query builder not-in sugar", () => {
  test("whereNotIn compiles to NOT IN", async () => {
    await withRepo(async ({ repo, connection }) => {
      connection.queue([]);

      await runWithSqlDialect("pgsql", async () => {
        await repo.query().whereNotIn("status", ["draft", "void"]).get();
      });

      expect(connection.calls[0]?.query).toContain("NOT IN");
      expect(connection.calls[0]?.params).toEqual(["draft", "void"]);
    });
  });

  test("whereNotNull still compiles to IS NOT NULL", async () => {
    await withRepo(async ({ repo, connection }) => {
      connection.queue([]);

      await runWithSqlDialect("pgsql", async () => {
        await repo.query().whereNotNull("status").get();
      });

      expect(connection.calls[0]?.query).toContain("IS NOT NULL");
    });
  });
});
