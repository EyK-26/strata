import { describe, expect, test } from "bun:test";
import { BaseRepository, type DatabaseConnection } from "@getstrata/core/database/baseRepository";
import { belongsTo, hasMany } from "@getstrata/core/database/relationships";
import { defineTable } from "@getstrata/core/database/table";

type Squad = { id: number; label: string };
type Member = { id: number; name: string; squad_id: number };

const squadTable = defineTable<Squad, "id">({
  name: "squad",
  primaryKey: "id",
  columns: ["id", "label"],
});

const memberTable = defineTable<Member, "id">({
  name: "member",
  primaryKey: "id",
  columns: ["id", "name", "squad_id"],
});

const squadHasMembers = hasMany<Squad, Member, "id", "squad_id">({
  name: "members",
  localKey: "id",
  foreignKey: "squad_id",
});

const memberBelongsToSquad = belongsTo<Member, Squad, "squad_id", "id">({
  name: "squad",
  foreignKey: "squad_id",
  ownerKey: "id",
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

class SquadRepository extends BaseRepository<Squad, "id"> {
  constructor(connection: DatabaseConnection) {
    super(squadTable, connection);
  }
}

class MemberRepository extends BaseRepository<Member, "id"> {
  constructor(connection: DatabaseConnection) {
    super(memberTable, connection);
  }
}

describe("RepositoryQuery", () => {
  test("withHasMany attaches related rows Laravel-style", async () => {
    const connection = new FakeConnection();
    const squads = new SquadRepository(connection);
    const members = new MemberRepository(connection);

    connection.queue([{ id: 1, label: "Alpha" }]);
    connection.queue([
      { id: 10, name: "Ripley", squad_id: 1 },
      { id: 11, name: "Hicks", squad_id: 1 },
    ]);

    const rows = await squads
      .query()
      .orderBy({ id: "asc" })
      .withHasMany("members", squadHasMembers, members)
      .get();

    expect(rows).toHaveLength(1);
    expect(rows[0]?.members).toEqual([
      { id: 10, name: "Ripley", squad_id: 1 },
      { id: 11, name: "Hicks", squad_id: 1 },
    ]);
    expect(connection.calls).toHaveLength(2);
  });

  test("withBelongsTo attaches parent rows", async () => {
    const connection = new FakeConnection();
    const squads = new SquadRepository(connection);
    const members = new MemberRepository(connection);

    connection.queue([{ id: 10, name: "Ripley", squad_id: 1 }]);
    connection.queue([{ id: 1, label: "Alpha" }]);

    const rows = await members.query().withBelongsTo("squad", memberBelongsToSquad, squads).get();

    expect(rows[0]?.squad).toEqual({ id: 1, label: "Alpha" });
  });

  test("supports where, limit, and first", async () => {
    const connection = new FakeConnection();
    const squads = new SquadRepository(connection);

    connection.queue([{ id: 2, label: "Bravo" }]);

    const row = await squads.query().where({ id: 2 }).limit(1).first();

    expect(row?.label).toBe("Bravo");
    expect(connection.calls[0]?.query).toContain("LIMIT 1");
  });

  test("returns empty arrays without extra queries when no parents match", async () => {
    const connection = new FakeConnection();
    const squads = new SquadRepository(connection);
    const members = new MemberRepository(connection);

    connection.queue([]);

    const rows = await squads.query().withHasMany("members", squadHasMembers, members).get();

    expect(rows).toEqual([]);
    expect(connection.calls).toHaveLength(1);
  });

  test("supports orWhere, offset, joins, groupBy, having, and paginate", async () => {
    const connection = new FakeConnection();
    const squads = new SquadRepository(connection);

    connection.queue([{ count: 1 }]);
    connection.queue([{ id: 1, label: "Alpha" }]);

    const page = await squads
      .query()
      .where({ id: 1 })
      .orWhere({ label: "Alpha" })
      .orWhere((builder) => builder.where({ id: 2 }))
      .orWhere((builder) => {
        builder.where({ id: 3 });
      })
      .offset(5)
      .join("member.squad_id", "squad.id")
      .leftJoin("member.squad_id", "squad.id")
      .leftJoin("member.squad_id", "squad.id")
      .groupBy(["id"])
      .having({ id: 1 })
      .paginate({ page: 1, perPage: 10 });

    expect(page.data).toHaveLength(1);
    expect(connection.calls.length).toBeGreaterThanOrEqual(2);
  });

  test("whereNull, whereNotNull, whereIn, and whereExists compile Laravel-style filters", async () => {
    const connection = new FakeConnection();
    const squads = new SquadRepository(connection);

    connection.queue([]);
    await squads.query().whereNull("label").get();
    expect(connection.calls.at(-1)?.query).toContain("IS NULL");

    connection.queue([]);
    await squads.query().whereNotNull("label").get();
    expect(connection.calls.at(-1)?.query).toContain("IS NOT NULL");

    connection.queue([]);
    await squads.query().whereIn("id", [1, 2]).get();
    expect(connection.calls.at(-1)?.query).toContain("IN");

    connection.queue([]);
    await squads
      .query()
      .whereExists("SELECT 1 FROM member WHERE member.squad_id = squad.id", [])
      .get();
    expect(connection.calls.at(-1)?.query).toContain("EXISTS");

    connection.queue([]);
    await squads
      .query()
      .whereNotExists(
        "SELECT 1 FROM member WHERE member.squad_id = squad.id AND member.id = $1",
        [9],
      )
      .get();
    expect(connection.calls.at(-1)?.query).toContain("NOT EXISTS");
  });
});
