import { expect, test } from "bun:test";
import { valueService } from "@getstrata/core/contracts/services";
import { createServiceToken } from "@getstrata/core/contracts/token";
import { BaseRepository } from "@getstrata/core/database/baseRepository";
import { createDatabaseBindings } from "@getstrata/core/database/bindings";
import {
  type AfterCommitRepositoryListener,
  defineRepository,
} from "@getstrata/core/database/definitions";
import { defineTable } from "@getstrata/core/database/table";
import { DATABASE_SESSION_TOKEN } from "@getstrata/core/database/tokens";
import { createApplication } from "@getstrata/core/runtime/application";
import type { DatabaseConnection } from "../../src/core/database/connectionContracts";
import { withRepositories } from "../helpers/boundRepositoryHarness";

type Item = { id: number; name: string };

const items = defineTable<Item, "id">({
  name: "orders",
  primaryKey: "id",
  columns: ["id", "name"],
});

class FakeConnection implements DatabaseConnection {
  private readonly responses: unknown[][] = [];

  queue(rows: unknown[]): void {
    this.responses.push(rows);
  }

  async unsafe<T>(): Promise<T[]> {
    return (this.responses.shift() ?? []) as T[];
  }
}

class ItemRepository extends BaseRepository<Item, "id"> {}

test("keeps repository create events until an explicit transaction commits", async () => {
  const connection = new FakeConnection();
  const seen: string[] = [];
  const listener = createServiceToken<AfterCommitRepositoryListener<Item>>("orders.created");
  const definition = defineRepository({
    name: "Items",
    table: items,
    dependencies: [],
    create: (binding) => new ItemRepository(binding),
    effects: [{ action: "created", afterCommit: listener }],
  });
  connection.queue([{ id: 1, name: "pending" }]);
  connection.queue([{ id: 2, name: "committed" }]);
  await withRepositories(
    connection,
    [definition] as const,
    async ([_repository], database) => {
      await database.transaction(async (tx) => {
        await tx.repository(definition).create({ id: 1, name: "pending" });
        expect(seen).toEqual([]);
      });
      await expect(
        database.transaction(async (tx) => {
          await tx.repository(definition).create({ id: 2, name: "committed" });
          throw new Error("rolled back");
        }),
      ).rejects.toThrow("rolled back");
      expect(seen).toEqual(["created"]);
    },
    "pgsql",
    [
      valueService(listener, () => {
        seen.push("created");
      }),
    ],
  );
});

test("repository effects promote successful children in order and discard failed child or outer publications", async () => {
  const seen: number[] = [];
  const listener = createServiceToken<AfterCommitRepositoryListener<Item>>("owned.orders.created");
  const definition = defineRepository({
    name: "OwnedOrders",
    table: items,
    dependencies: [],
    create: (binding) => new ItemRepository(binding),
    effects: [{ action: "created", afterCommit: listener }],
  });
  const app = createApplication({
    providers: [],
    services: [
      valueService(listener, (row) => {
        seen.push(row.id);
      }),
      ...createDatabaseBindings({
        default: "main",
        connections: { main: { driver: "sqlite", filename: ":memory:" } },
        repositories: [definition],
      }),
    ],
  });
  const failures: unknown[] = [];
  try {
    await app.start();
    await app.run(async (scope) => {
      const database = scope.resolve(DATABASE_SESSION_TOKEN);
      await database.execute({
        text: "CREATE TABLE orders(id INTEGER PRIMARY KEY,name TEXT)",
        params: [],
      });
      await database.transaction(() => "empty");
      expect(seen).toEqual([]);
      await database.transaction(async (parent) => {
        await parent.repository(definition).create({ id: 1, name: "parent" });
        await parent.transaction(async (child) => {
          await child.repository(definition).create({ id: 2, name: "promoted" });
        });
        const result = await parent.transaction(async (child) => {
          await child.repository(definition).create({ id: 3, name: "discarded" });
          child.requestRollback();
          return false;
        });
        expect(result).toBe(false);
        expect(seen).toEqual([]);
        await parent.repository(definition).create({ id: 4, name: "parent-last" });
      });
      expect(seen).toEqual([1, 2, 4]);
      expect(
        await database.execute({ text: "SELECT id FROM orders ORDER BY id", params: [] }),
      ).toEqual([{ id: 1 }, { id: 2 }, { id: 4 }]);
      await expect(
        database.transaction(async (parent) => {
          await parent.repository(definition).create({ id: 5, name: "outer-failure" });
          await parent.transaction(async (child) => {
            await child.repository(definition).create({ id: 6, name: "promoted-then-failed" });
          });
          expect(seen).toEqual([1, 2, 4]);
          throw new Error("outer rollback");
        }),
      ).rejects.toThrow("outer rollback");
      expect(seen).toEqual([1, 2, 4]);
      expect(
        await database.execute({ text: "SELECT id FROM orders ORDER BY id", params: [] }),
      ).toEqual([{ id: 1 }, { id: 2 }, { id: 4 }]);
    });
  } catch (error) {
    failures.push(error);
  } finally {
    try {
      const stopped = await app.stop();
      if (!stopped.successful)
        failures.push(new Error("Repository composition cleanup failed", { cause: stopped }));
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length)
    throw new AggregateError(failures, "Repository composition and cleanup failed");
});
