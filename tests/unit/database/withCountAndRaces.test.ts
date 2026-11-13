import { describe, expect, test } from "bun:test";
import assert from "node:assert/strict";
import { BaseRepository } from "@getstrata/core/database/baseRepository";
import { type BoundModel, defineRepository } from "@getstrata/core/database/definitions";
import { PersistenceError } from "@getstrata/core/database/errors";
import { defineModel, Model } from "@getstrata/core/database/model";
import { defineTable } from "@getstrata/core/database/table";
import { ConflictError } from "@getstrata/core/errors/http";
import type { SqlFixture as DatabaseConnection } from "../../helpers/boundRepositoryHarness";
import { withBoundDatabase } from "../../helpers/boundRepositoryHarness";

type Squad = { id: number; label: string };
type Member = { id: number; name: string; squad_id: number };

const squadTable = defineTable<Squad, "id">({
  name: "squads",
  primaryKey: "id",
  columns: ["id", "label"],
});

const memberTable = defineTable<Member, "id">({
  name: "members",
  primaryKey: "id",
  columns: ["id", "name", "squad_id"],
});

class FakeConnection implements DatabaseConnection {
  readonly calls: Array<{ query: string; params: readonly unknown[] }> = [];
  private readonly responses: unknown[][] = [];
  failNextInsertWith?: Error;

  queue(rows: unknown[]): void {
    this.responses.push(rows);
  }

  async unsafe<T>(query: string, params: readonly unknown[] = []): Promise<T[]> {
    this.calls.push({ query, params: [...params] });

    if (this.failNextInsertWith && query.startsWith("INSERT")) {
      const error = this.failNextInsertWith;
      this.failNextInsertWith = undefined;
      throw error;
    }

    return (this.responses.shift() ?? []) as T[];
  }
}

class MemberModelClass extends Model<Member, "id"> {}
class SquadModelClass extends Model<Squad, "id"> {
  members() {
    return this.hasMany(memberDefinition);
  }
}
const members = defineRepository({
  name: "members",
  table: memberTable,
  dependencies: [] as const,
  create: (binding) => new BaseRepository(binding),
});
const squads = defineRepository({
  name: "squads",
  table: squadTable,
  dependencies: [] as const,
  create: (binding) => new BaseRepository(binding),
});
const memberDefinition = defineModel({
  name: "MemberModel",
  repository: members,
  dependencies: [] as const,
  attributes: { timestamps: false, fillable: ["name", "squad_id"] },
  construct: (state, binding) => new MemberModelClass(state, binding),
});
const squadDefinition = defineModel({
  name: "SquadModel",
  repository: squads,
  dependencies: [] as const,
  attributes: { timestamps: false, fillable: ["label"] },
  construct: (state, binding) => new SquadModelClass(state, binding),
});
async function withGraph<T>(
  connection: FakeConnection,
  work: (graph: {
    SquadModel: BoundModel<Squad, "id", SquadModelClass>;
    MemberModel: BoundModel<Member, "id", MemberModelClass>;
    SquadClass: typeof SquadModelClass;
  }) => T | Promise<T>,
) {
  return withBoundDatabase(
    {
      definition: {
        default: "test",
        connections: { test: { driver: "sqlite", filename: ":memory:" } },
        repositories: [members, squads],
        models: [memberDefinition, squadDefinition],
      },
      connection,
    },
    (database) =>
      work({
        SquadModel: database.model(squadDefinition),
        MemberModel: database.model(memberDefinition),
        SquadClass: SquadModelClass,
      }),
  );
}

describe("withCount", () => {
  test("adds an aliased count subquery correlated to the parent", async () => {
    const connection = new FakeConnection();
    await withGraph(connection, async ({ SquadModel }) => {
      connection.queue([{ id: 1, label: "alpha", members_count: 3 }]);

      await (async () => SquadModel.query().withCount("members").get())();

      const sql = connection.calls[0]?.query ?? "";
      expect(sql).toContain("SELECT COUNT(*)");
      expect(sql).toContain('AS "members_count"');
      expect(sql).toContain('"members"."squad_id" = "squads"."id"');
    });
  });

  test("keeps the base columns alongside the count", async () => {
    const connection = new FakeConnection();
    await withGraph(connection, async ({ SquadModel }) => {
      connection.queue([{ id: 1, label: "alpha", members_count: 3 }]);

      await (async () => SquadModel.query().withCount("members").get())();

      const sql = connection.calls[0]?.query ?? "";
      expect(sql).toContain('"squads"."id"');
      expect(sql).toContain('"squads"."label"');
    });
  });

  test("accepts a custom alias", async () => {
    const connection = new FakeConnection();
    await withGraph(connection, async ({ SquadModel }) => {
      connection.queue([{ id: 1, label: "alpha", total: 3 }]);

      await (async () => SquadModel.query().withCount("members", "total").get())();

      expect(connection.calls[0]?.query).toContain('AS "total"');
    });
  });

  test("the count is readable on the hydrated model", async () => {
    const connection = new FakeConnection();
    await withGraph(connection, async ({ SquadModel }) => {
      connection.queue([{ id: 1, label: "alpha", members_count: 3 }]);

      const [squad] = await (async () => SquadModel.query().withCount("members").get())();

      expect(squad?.toObject().members_count).toBe(3);
    });
  });

  test("count aliases preserve driver values during hydration", async () => {
    const connection = new FakeConnection();
    await withGraph(connection, async ({ SquadModel, SquadClass }) => {
      connection.queue([{ id: 1, label: "alpha", members_count: "3", total: 4n }]);

      const squad = await (async () =>
        SquadModel.query().withCount("members").withCount("members", "total").first())();

      expect(squad?.toObject().members_count).toBe("3");
      expect(squad?.get("total")).toBe(4n);
      expect(squad).toBeInstanceOf(SquadClass);
    });
  });

  test("combines with a where clause without breaking parameter order", async () => {
    const connection = new FakeConnection();
    await withGraph(connection, async ({ SquadModel }) => {
      connection.queue([]);

      await (async () => SquadModel.query().withCount("members").where({ label: "alpha" }).get())();

      expect(connection.calls[0]?.params).toEqual(["alpha"]);
    });
  });

  test("an unknown relation name throws", async () => {
    const connection = new FakeConnection();
    await withGraph(connection, async ({ SquadModel }) => {
      expect(() => SquadModel.query().withCount("nope")).toThrow(/no relation method/);
    });
  });
});

describe("firstOrCreate races", () => {
  test("returns the existing row without inserting", async () => {
    const connection = new FakeConnection();
    await withGraph(connection, async ({ SquadModel }) => {
      connection.queue([{ id: 1, label: "alpha" }]);

      const squad = await (async () => SquadModel.firstOrCreate({ label: "alpha" }))();

      expect(squad.toObject().id).toBe(1);
      expect(connection.calls.every((call) => !call.query.startsWith("INSERT"))).toBe(true);
    });
  });

  test("inserts when nothing exists yet", async () => {
    const connection = new FakeConnection();
    await withGraph(connection, async ({ SquadModel }) => {
      connection.queue([]);
      connection.queue([{ id: 2, label: "beta" }]);

      const squad = await (async () => SquadModel.firstOrCreate({ label: "beta" }))();

      expect(squad.toObject().id).toBe(2);
    });
  });

  test("a concurrent unique insert is recovered by re-reading neutral and native duplicate failures", async () => {
    for (const duplicate of [
      new PersistenceError("DATABASE_UNIQUE_CONSTRAINT"),
      Object.assign(new Error("native duplicate key"), { code: "23505" }),
    ]) {
      const connection = new FakeConnection();
      await withGraph(connection, async ({ SquadModel }) => {
        connection.queue([]);
        connection.failNextInsertWith = duplicate;
        connection.queue([{ id: 3, label: "gamma" }]);

        const squad = await (async () => SquadModel.firstOrCreate({ label: "gamma" }))();

        expect(squad.toObject()).toEqual({ id: 3, label: "gamma" });
        expect(connection.calls).toHaveLength(3);
        expect(connection.calls.filter((call) => call.query.startsWith("INSERT"))).toHaveLength(1);
        expect(connection.calls.filter((call) => call.query.startsWith("SELECT"))).toHaveLength(2);
        expect(connection.calls[0]?.params).toEqual(["gamma"]);
        expect(connection.calls[2]?.params).toEqual(["gamma"]);
      });
    }
  });

  test("a unique violation with no winning row preserves the original neutral error", async () => {
    const connection = new FakeConnection();
    await withGraph(connection, async ({ SquadModel }) => {
      const duplicate = new PersistenceError("DATABASE_UNIQUE_CONSTRAINT");
      connection.queue([]);
      connection.failNextInsertWith = duplicate;
      connection.queue([]);

      await assert.rejects(
        async () => await (async () => SquadModel.firstOrCreate({ label: "delta" }))(),
        (error: unknown) => error === duplicate,
      );
      expect(connection.calls).toHaveLength(3);
      expect(connection.calls.filter((call) => call.query.startsWith("INSERT"))).toHaveLength(1);
    });
  });

  test("domain conflicts and non-unique persistence failures propagate without a race reread", async () => {
    for (const failure of [
      new ConflictError("unrelated domain conflict"),
      new PersistenceError("DATABASE_CHECK_CONSTRAINT"),
    ]) {
      const connection = new FakeConnection();
      await withGraph(connection, async ({ SquadModel }) => {
        connection.queue([]);
        connection.failNextInsertWith = failure;
        // A row available to a mistaken reread must not hide the unrelated failure.
        connection.queue([{ id: 4, label: "unrelated" }]);
        await assert.rejects(
          async () => await (async () => SquadModel.firstOrCreate({ label: "unrelated" }))(),
          (error: unknown) =>
            failure instanceof PersistenceError
              ? error === failure
              : error instanceof PersistenceError &&
                error.code === "DATABASE_OPERATION_FAILED" &&
                error.cause === failure,
        );
        expect(connection.calls).toHaveLength(2);
        expect(connection.calls.filter((call) => call.query.startsWith("INSERT"))).toHaveLength(1);
        expect(connection.calls.filter((call) => call.query.startsWith("SELECT"))).toHaveLength(1);
      });
    }
  });

  test("a non-conflict error is not swallowed or mistaken for a race", async () => {
    const connection = new FakeConnection();
    await withGraph(connection, async ({ SquadModel }) => {
      const failure = new Error("connection reset");
      connection.queue([]);
      connection.failNextInsertWith = failure;

      await assert.rejects(
        async () => await (async () => SquadModel.firstOrCreate({ label: "epsilon" }))(),
        (error: unknown) =>
          failure instanceof PersistenceError
            ? error === failure
            : error instanceof PersistenceError &&
              error.code === "DATABASE_OPERATION_FAILED" &&
              error.cause === failure,
      );
      expect(connection.calls).toHaveLength(2);
    });
  });
});
