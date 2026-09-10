import { describe, expect, test } from "bun:test";
import { BaseRepository, type DatabaseConnection } from "@getstrata/core/database/baseRepository";
import { runWithSqlDialect } from "@getstrata/core/database/dialect";
import { Model, registerModelRepository } from "@getstrata/core/database/model";
import { defineTable } from "@getstrata/core/database/table";
import { ConflictError } from "@getstrata/core/errors/http";

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

function createGraph(connection: FakeConnection) {
  class MemberModel extends Model<Member, "id"> {
    static override $timestamps = false;
    static override $fillable = ["name", "squad_id"] as const;
    protected override primaryKey(): "id" {
      return "id";
    }
  }

  class SquadModel extends Model<Squad, "id"> {
    static override $timestamps = false;
    static override $fillable = ["label"] as const;
    protected override primaryKey(): "id" {
      return "id";
    }

    members() {
      return this.hasMany(MemberModel);
    }
  }

  registerModelRepository(
    MemberModel,
    new (class extends BaseRepository<Member, "id"> {
      constructor() {
        super(memberTable, connection);
      }
    })(),
  );

  registerModelRepository(
    SquadModel,
    new (class extends BaseRepository<Squad, "id"> {
      constructor() {
        super(squadTable, connection);
      }
    })(),
  );

  return { SquadModel, MemberModel };
}

describe("withCount", () => {
  test("adds an aliased count subquery correlated to the parent", async () => {
    const connection = new FakeConnection();
    const { SquadModel } = createGraph(connection);
    connection.queue([{ id: 1, label: "alpha", members_count: 3 }]);

    await runWithSqlDialect("pgsql", async () => SquadModel.query().withCount("members").get());

    const sql = connection.calls[0]?.query ?? "";
    expect(sql).toContain("SELECT COUNT(*)");
    expect(sql).toContain('AS "members_count"');
    expect(sql).toContain('"members"."squad_id" = "squads"."id"');
  });

  test("keeps the base columns alongside the count", async () => {
    const connection = new FakeConnection();
    const { SquadModel } = createGraph(connection);
    connection.queue([{ id: 1, label: "alpha", members_count: 3 }]);

    await runWithSqlDialect("pgsql", async () => SquadModel.query().withCount("members").get());

    const sql = connection.calls[0]?.query ?? "";
    expect(sql).toContain('"squads"."id"');
    expect(sql).toContain('"squads"."label"');
  });

  test("accepts a custom alias", async () => {
    const connection = new FakeConnection();
    const { SquadModel } = createGraph(connection);
    connection.queue([{ id: 1, label: "alpha", total: 3 }]);

    await runWithSqlDialect("pgsql", async () =>
      SquadModel.query().withCount("members", "total").get(),
    );

    expect(connection.calls[0]?.query).toContain('AS "total"');
  });

  test("the count is readable on the hydrated model", async () => {
    const connection = new FakeConnection();
    const { SquadModel } = createGraph(connection);
    connection.queue([{ id: 1, label: "alpha", members_count: 3 }]);

    const [squad] = await runWithSqlDialect("pgsql", async () =>
      SquadModel.query().withCount("members").get(),
    );

    expect(squad?.toObject().members_count).toBe(3);
  });

  test("combines with a where clause without breaking parameter order", async () => {
    const connection = new FakeConnection();
    const { SquadModel } = createGraph(connection);
    connection.queue([]);

    await runWithSqlDialect("pgsql", async () =>
      SquadModel.query().withCount("members").where({ label: "alpha" }).get(),
    );

    expect(connection.calls[0]?.params).toEqual(["alpha"]);
  });

  test("an unknown relation name throws", () => {
    const connection = new FakeConnection();
    const { SquadModel } = createGraph(connection);

    expect(() => SquadModel.query().withCount("nope")).toThrow(/no relation method/);
  });
});

describe("firstOrCreate races", () => {
  test("returns the existing row without inserting", async () => {
    const connection = new FakeConnection();
    const { SquadModel } = createGraph(connection);
    connection.queue([{ id: 1, label: "alpha" }]);

    const squad = await runWithSqlDialect("pgsql", async () =>
      SquadModel.firstOrCreate({ label: "alpha" }),
    );

    expect(squad.toObject().id).toBe(1);
    expect(connection.calls.every((call) => !call.query.startsWith("INSERT"))).toBe(true);
  });

  test("inserts when nothing exists yet", async () => {
    const connection = new FakeConnection();
    const { SquadModel } = createGraph(connection);
    connection.queue([]);
    connection.queue([{ id: 2, label: "beta" }]);

    const squad = await runWithSqlDialect("pgsql", async () =>
      SquadModel.firstOrCreate({ label: "beta" }),
    );

    expect(squad.toObject().id).toBe(2);
  });

  test("a concurrent insert is recovered by re-reading instead of surfacing a conflict", async () => {
    const connection = new FakeConnection();
    const { SquadModel } = createGraph(connection);
    connection.queue([]);
    connection.failNextInsertWith = new ConflictError("duplicate key");
    connection.queue([{ id: 3, label: "gamma" }]);

    const squad = await runWithSqlDialect("pgsql", async () =>
      SquadModel.firstOrCreate({ label: "gamma" }),
    );

    expect(squad.toObject().id).toBe(3);
  });

  test("a conflict with no winning row still surfaces", async () => {
    const connection = new FakeConnection();
    const { SquadModel } = createGraph(connection);
    connection.queue([]);
    connection.failNextInsertWith = new ConflictError("duplicate key");
    connection.queue([]);

    await expect(
      runWithSqlDialect("pgsql", async () => SquadModel.firstOrCreate({ label: "delta" })),
    ).rejects.toThrow(ConflictError);
  });

  test("a non-conflict error is not swallowed or mistaken for a race", async () => {
    const connection = new FakeConnection();
    const { SquadModel } = createGraph(connection);
    connection.queue([]);
    connection.failNextInsertWith = new Error("connection reset");

    const caught = await runWithSqlDialect("pgsql", async () => {
      try {
        await SquadModel.firstOrCreate({ label: "epsilon" });
        return null;
      } catch (error) {
        return error;
      }
    });

    expect(caught).not.toBeNull();
    expect(caught).not.toBeInstanceOf(ConflictError);
  });
});
