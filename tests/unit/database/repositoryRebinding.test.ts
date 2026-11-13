import { describe, expect, test } from "bun:test";
import { valueService } from "@getstrata/core/contracts/services";
import { createServiceToken } from "@getstrata/core/contracts/token";
import { BaseRepository } from "@getstrata/core/database/baseRepository";
import {
  type AfterCommitRepositoryListener,
  defineRepository,
  type RepositoryBinding,
} from "@getstrata/core/database/definitions";
import { defineTable } from "@getstrata/core/database/table";
import type { DatabaseConnection } from "../../../src/core/database/connectionContracts";
import { withBoundDatabase, withRepositories } from "../../helpers/boundRepositoryHarness";

type RecordRow = { id: number; scope: string };
const table = defineTable<RecordRow, "id">({
  name: "rebinding_records",
  primaryKey: "id",
  columns: ["id", "scope"],
});
class RecordingConnection implements DatabaseConnection {
  readonly calls: Array<{ query: string; params: readonly unknown[] }> = [];
  constructor(private readonly row: RecordRow) {}
  async unsafe<T>(query: string, params: readonly unknown[] = []): Promise<T[]> {
    this.calls.push({ query, params });
    return [this.row] as T[];
  }
}
class ExplicitRepository extends BaseRepository<RecordRow, "id"> {
  readonly label = "records";
  labelFromInheritedMethod() {
    return this.label;
  }
}
class ScopedRepository extends BaseRepository<RecordRow, "id"> {
  readonly #scope: string;
  constructor(binding: RepositoryBinding<RecordRow, "id">, scope: string) {
    super(binding);
    this.#scope = scope;
  }
  findScoped() {
    return this.findAll({ where: { scope: this.#scope } });
  }
}
const explicit = defineRepository({
  name: "Explicit",
  table,
  dependencies: [],
  create: (binding) => new ExplicitRepository(binding),
});
const scoped = defineRepository({
  name: "Scoped",
  table,
  dependencies: [],
  create: (binding) => new ScopedRepository(binding, "tenant"),
});

describe("explicit repository construction", () => {
  test("keeps the default prototype and own-state behavior without mutating the original", async () => {
    const originalConnection = new RecordingConnection({ id: 1, scope: "original" });
    const reboundConnection = new RecordingConnection({ id: 2, scope: "rebound" });
    let original!: ExplicitRepository;
    await withRepositories(
      originalConnection,
      [explicit] as const,
      async ([repository], database) => {
        original = repository;
        expect(database.repository(explicit)).toBe(original);
      },
    );
    await withRepositories(reboundConnection, [explicit] as const, async ([rebound], database) => {
      expect(rebound).toBeInstanceOf(ExplicitRepository);
      expect(rebound).not.toBe(original);
      expect(rebound.labelFromInheritedMethod()).toBe("records");
      expect(rebound.getTable()).toBe(original.getTable());
      expect(database.repository(explicit)).toBe(rebound);
      expect(await rebound.findById(2)).toEqual({ id: 2, scope: "rebound" });
    });
    expect(originalConnection.calls).toHaveLength(0);
    expect(reboundConnection.calls).toHaveLength(1);
  });
  test("uses explicit constructors to preserve native private state across independent bindings", async () => {
    const originalConnection = new RecordingConnection({ id: 1, scope: "tenant" });
    const firstConnection = new RecordingConnection({ id: 2, scope: "tenant" });
    const secondConnection = new RecordingConnection({ id: 3, scope: "tenant" });
    const instances: ScopedRepository[] = [];
    const rows = await Promise.all(
      [firstConnection, secondConnection, originalConnection].map((connection) =>
        withRepositories(connection, [scoped] as const, async ([repository], database) => {
          instances.push(repository);
          expect(repository).toBeInstanceOf(ScopedRepository);
          expect(database.repository(scoped)).toBe(repository);
          return repository.findScoped();
        }),
      ),
    );
    expect(instances[0]).not.toBe(instances[1]);
    expect(rows.map((result) => result[0]?.id)).toEqual([2, 3, 1]);
    for (const connection of [originalConnection, firstConnection, secondConnection]) {
      expect(connection.calls).toHaveLength(1);
      expect(connection.calls[0]?.params).toEqual(["tenant"]);
    }
  });
});

test("private-state repository construction preserves transaction rollback and after-commit events", async () => {
  const received: unknown[] = [];
  const listener = createServiceToken<AfterCommitRepositoryListener<RecordRow>>("records.created");
  const definition = defineRepository({
    name: "Events",
    table,
    dependencies: [],
    create: (binding) => new ScopedRepository(binding, "tenant"),
    effects: [{ action: "created", afterCommit: listener }],
  });
  await withBoundDatabase(
    {
      definition: {
        default: "main",
        connections: { main: { driver: "sqlite", filename: ":memory:" } },
        repositories: [definition],
      },
      services: [
        valueService(listener, (row) => {
          received.push(row);
        }),
      ],
    },
    async (database) => {
      await database.execute({
        text: "CREATE TABLE rebinding_records(id INTEGER PRIMARY KEY, scope TEXT NOT NULL)",
        params: [],
      });
      const original = database.repository(definition);
      await expect(
        database.transaction(async (transaction) => {
          const bound = transaction.repository(definition);
          expect(bound).not.toBe(original);
          await bound.create({ id: 1, scope: "tenant" });
          expect((await bound.findScoped()).map((row) => row.id)).toEqual([1]);
          expect(received).toEqual([]);
          throw new Error("Roll back rebound repository write");
        }),
      ).rejects.toThrow("Roll back rebound repository write");
      expect(await original.findScoped()).toEqual([]);
      expect(received).toEqual([]);
      await database.transaction(async (transaction) => {
        await transaction.repository(definition).create({ id: 2, scope: "tenant" });
        expect(received).toEqual([]);
      });
      expect(received).toEqual([{ id: 2, scope: "tenant" }]);
      expect((await original.findScoped()).map((row) => row.id)).toEqual([2]);
      expect(database.repository(definition)).toBe(original);
    },
  );
});
