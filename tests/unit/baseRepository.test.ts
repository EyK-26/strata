import { describe, expect, test } from "bun:test";
import { BaseRepository, type DatabaseConnection } from "@getstrata/core/database/baseRepository";
import { hasMany, hasManyThrough } from "@getstrata/core/database/relationships";
import { defineTable } from "@getstrata/core/database/table";
import { NotFoundError } from "@getstrata/core/errors/http";

type CrewMember = {
  id: number;
  name: string;
  squad_id: number;
  is_active: boolean;
};

type Squad = {
  id: number;
  label: string;
};

const crewMemberTable = defineTable<CrewMember, "id">({
  name: "crew_member",
  primaryKey: "id",
  columns: ["id", "name", "squad_id", "is_active"],
  defaultOrderBy: { column: "id", direction: "ASC" },
});

const squadHasManyCrewMembers = hasMany<Squad, CrewMember, "id", "squad_id">({
  name: "crewMembers",
  localKey: "id",
  foreignKey: "squad_id",
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

class CrewRepository extends BaseRepository<CrewMember, "id"> {
  constructor(connection: DatabaseConnection) {
    super(crewMemberTable, connection);
  }

  async loadBySquads(squads: readonly Squad[]): Promise<Map<number, CrewMember[]>> {
    return await this.loadHasManyForParents(squads, squadHasManyCrewMembers);
  }
}

describe("base repository", () => {
  test("creates records with returning columns", async () => {
    const connection = new FakeConnection();
    const repository = new CrewRepository(connection);
    const createdRecord: CrewMember = {
      id: 7,
      name: "Trillian Astra",
      squad_id: 2,
      is_active: true,
    };

    connection.queue([createdRecord]);

    const result = await repository.create(createdRecord);

    expect(result).toEqual(createdRecord);
    expect(connection.calls[0]).toEqual({
      query:
        'INSERT INTO "crew_member" ("id", "name", "squad_id", "is_active") VALUES ($1, $2, $3, $4) RETURNING "crew_member"."id", "crew_member"."name", "crew_member"."squad_id", "crew_member"."is_active"',
      params: [7, "Trillian Astra", 2, true],
    });
  });

  test("updates records by id and returns the updated row", async () => {
    const connection = new FakeConnection();
    const repository = new CrewRepository(connection);
    const updatedRecord: CrewMember = {
      id: 7,
      name: "Zaphod Beeblebrox",
      squad_id: 2,
      is_active: false,
    };

    connection.queue([updatedRecord]);

    const result = await repository.updateById(7, {
      name: "Zaphod Beeblebrox",
      is_active: false,
    });

    expect(result).toEqual(updatedRecord);
    expect(connection.calls[0]).toEqual({
      query:
        'UPDATE "crew_member" SET "name" = $1, "is_active" = $2 WHERE "id" = $3 RETURNING "crew_member"."id", "crew_member"."name", "crew_member"."squad_id", "crew_member"."is_active"',
      params: ["Zaphod Beeblebrox", false, 7],
    });
  });

  test("deletes records by id and reports whether a row was removed", async () => {
    const connection = new FakeConnection();
    const repository = new CrewRepository(connection);

    connection.queue([{ deleted_id: 7 }]);
    connection.queue([]);

    expect(await repository.deleteById(7)).toBe(true);
    expect(await repository.deleteById(999)).toBe(false);
    expect(connection.calls[0]).toEqual({
      query: 'DELETE FROM "crew_member" WHERE "id" = $1 RETURNING "id" AS "deleted_id"',
      params: [7],
    });
    expect(connection.calls[1]).toEqual({
      query: 'DELETE FROM "crew_member" WHERE "id" = $1 RETURNING "id" AS "deleted_id"',
      params: [999],
    });
  });

  test("throws custom errors when findByIdOrThrow cannot resolve a record", async () => {
    const connection = new FakeConnection();
    const repository = new CrewRepository(connection);

    connection.queue([]);

    await expect(
      repository.findByIdOrThrow(404, (id) => new NotFoundError(`Crew member ${id} not found.`)),
    ).rejects.toThrow("Crew member 404 not found.");
    expect(connection.calls[0]).toEqual({
      query:
        'SELECT "crew_member"."id", "crew_member"."name", "crew_member"."squad_id", "crew_member"."is_active" FROM "crew_member" WHERE "crew_member"."id" = $1 ORDER BY "crew_member"."id" ASC LIMIT 1',
      params: [404],
    });
  });

  test("paginates records with total metadata", async () => {
    const connection = new FakeConnection();
    const repository = new CrewRepository(connection);

    connection.queue([{ count: "25" }]);
    connection.queue([
      { id: 11, name: "Arthur", squad_id: 1, is_active: true },
      { id: 12, name: "Ford", squad_id: 1, is_active: true },
    ]);

    const result = await repository.paginate({ page: 2, perPage: 10 });

    expect(result.meta).toEqual({
      page: 2,
      per_page: 10,
      total: 25,
      last_page: 3,
    });
    expect(result.data).toHaveLength(2);
    expect(connection.calls[1]).toEqual({
      query:
        'SELECT "crew_member"."id", "crew_member"."name", "crew_member"."squad_id", "crew_member"."is_active" FROM "crew_member" ORDER BY "crew_member"."id" ASC LIMIT 10 OFFSET 10',
      params: [],
    });
  });

  test("eager loads hasMany relations for multiple parents in one query", async () => {
    const connection = new FakeConnection();
    const repository = new CrewRepository(connection);
    const squads: Squad[] = [
      { id: 1, label: "Alpha" },
      { id: 2, label: "Beta" },
    ];
    const crewMembers: CrewMember[] = [
      { id: 1, name: "Arthur Dent", squad_id: 1, is_active: true },
      { id: 2, name: "Ford Prefect", squad_id: 1, is_active: true },
    ];

    connection.queue(crewMembers);

    const groups = await repository.loadBySquads(squads);

    expect(groups.get(1)).toEqual(crewMembers);
    expect(groups.get(2)).toEqual([]);
    expect(connection.calls[0]).toEqual({
      query:
        'SELECT "crew_member"."id", "crew_member"."name", "crew_member"."squad_id", "crew_member"."is_active" FROM "crew_member" WHERE "crew_member"."squad_id" IN ($1, $2) ORDER BY "crew_member"."id" ASC',
      params: [1, 2],
    });
  });

  test("loads hasManyThrough rows through an intermediate table", async () => {
    type Department = { id: number };
    type Application = { id: number; position_id: number; title: string };
    const applicationTable = defineTable<Application, "id">({
      name: "applications",
      primaryKey: "id",
      columns: ["id", "position_id", "title"],
    });
    const relation = hasManyThrough<
      Department,
      Application,
      "id",
      "department_id",
      "id",
      "position_id"
    >({
      name: "applications",
      throughTable: "positions",
      localKey: "id",
      firstKey: "department_id",
      secondLocalKey: "id",
      secondKey: "position_id",
    });
    const connection = new FakeConnection();
    class ApplicationRepository extends BaseRepository<Application, "id"> {
      constructor() {
        super(applicationTable, connection);
      }
    }
    const repository = new ApplicationRepository();
    connection.queue([
      { id: 10, position_id: 4, title: "A", __through_parent_id: 1 },
      { id: 11, position_id: 5, title: "B", __through_parent_id: 2 },
    ]);

    const grouped = await repository.loadHasManyThroughForParents(
      [{ id: 1 }, { id: 2 }, { id: 3 }],
      relation,
    );

    expect(grouped.get(1)).toEqual([{ id: 10, position_id: 4, title: "A" }]);
    expect(grouped.get(2)).toEqual([{ id: 11, position_id: 5, title: "B" }]);
    expect(grouped.get(3)).toEqual([]);
    expect(connection.calls[0]?.query).toContain('INNER JOIN "positions"');
    expect(connection.calls[0]?.query).toContain('"positions"."department_id" IN ($1, $2, $3)');
    expect(connection.calls[0]?.params).toEqual([1, 2, 3]);
  });

  test("findHasManyThrough returns the matching far rows for one parent", async () => {
    type Department = { id: number };
    type Application = { id: number; position_id: number; title: string };
    const applicationTable = defineTable<Application, "id">({
      name: "applications",
      primaryKey: "id",
      columns: ["id", "position_id", "title"],
    });
    const relation = hasManyThrough<
      Department,
      Application,
      "id",
      "department_id",
      "id",
      "position_id"
    >({
      name: "applications",
      throughTable: "positions",
      localKey: "id",
      firstKey: "department_id",
      secondLocalKey: "id",
      secondKey: "position_id",
    });
    const connection = new FakeConnection();
    class ApplicationRepository extends BaseRepository<Application, "id"> {
      constructor() {
        super(applicationTable, connection);
      }
    }
    const repository = new ApplicationRepository();
    connection.queue([{ id: 10, position_id: 4, title: "A", __through_parent_id: 1 }]);

    const rows = await repository.findHasManyThrough(1, relation, { where: { title: "A" } });

    expect(rows).toEqual([{ id: 10, position_id: 4, title: "A" }]);
    expect(connection.calls[0]?.query).toContain('"applications"."title" = $2');
    expect(connection.calls[0]?.query).toContain('"positions"."department_id" IN ($1)');
    expect(connection.calls[0]?.params).toEqual([1, "A"]);
  });

  test("loadHasManyThroughForParents returns an empty map without querying", async () => {
    type Department = { id: number };
    type Application = { id: number; position_id: number; title: string };
    const applicationTable = defineTable<Application, "id">({
      name: "applications",
      primaryKey: "id",
      columns: ["id", "position_id", "title"],
    });
    const relation = hasManyThrough<
      Department,
      Application,
      "id",
      "department_id",
      "id",
      "position_id"
    >({
      name: "applications",
      throughTable: "positions",
      localKey: "id",
      firstKey: "department_id",
      secondLocalKey: "id",
      secondKey: "position_id",
    });
    const connection = new FakeConnection();
    class ApplicationRepository extends BaseRepository<Application, "id"> {
      constructor() {
        super(applicationTable, connection);
      }
    }

    const grouped = await new ApplicationRepository().loadHasManyThroughForParents([], relation);

    expect(grouped.size).toBe(0);
    expect(connection.calls).toHaveLength(0);
  });

  test("hasManyThrough respects soft-delete scopes", async () => {
    type Department = { id: number };
    type Application = { id: number; position_id: number; title: string; deleted_at: Date | null };
    const applicationTable = defineTable<Application, "id">({
      name: "applications",
      primaryKey: "id",
      columns: ["id", "position_id", "title", "deleted_at"],
      softDeletes: true,
    });
    const relation = hasManyThrough<
      Department,
      Application,
      "id",
      "department_id",
      "id",
      "position_id"
    >({
      name: "applications",
      throughTable: "positions",
      localKey: "id",
      firstKey: "department_id",
      secondLocalKey: "id",
      secondKey: "position_id",
    });
    const connection = new FakeConnection();
    class ApplicationRepository extends BaseRepository<Application, "id"> {
      constructor() {
        super(applicationTable, connection);
      }
    }
    const repository = new ApplicationRepository();

    connection.queue([]);
    await repository.loadHasManyThroughForParents([{ id: 1 }], relation);
    expect(connection.calls.at(-1)?.query).toContain('"applications"."deleted_at" IS NULL');

    connection.queue([]);
    await repository.loadHasManyThroughForParents([{ id: 1 }], relation, { withTrashed: true });
    expect(connection.calls.at(-1)?.query).not.toContain("IS NULL");
    expect(connection.calls.at(-1)?.query).not.toContain("IS NOT NULL");

    connection.queue([]);
    await repository.loadHasManyThroughForParents([{ id: 1 }], relation, { onlyTrashed: true });
    expect(connection.calls.at(-1)?.query).toContain('"applications"."deleted_at" IS NOT NULL');
  });
});
