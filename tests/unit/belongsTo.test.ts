import { describe, expect, test } from "bun:test";
import {
  BaseRepository,
  type DatabaseConnection,
  defineTable,
  hasMany,
  indexBelongsToRelation,
} from "../../src/core/database";

type Squad = {
  id: number;
  label: string;
};

type CrewMember = {
  id: number;
  name: string;
  squad_id: number;
};

const squadTable = defineTable<Squad, "id">({
  name: "squad",
  primaryKey: "id",
  columns: ["id", "label"],
  defaultOrderBy: { column: "id", direction: "ASC" },
});

const crewTable = defineTable<CrewMember, "id">({
  name: "crew_member",
  primaryKey: "id",
  columns: ["id", "name", "squad_id"],
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

class SquadRepository extends BaseRepository<Squad, "id"> {
  constructor(connection: DatabaseConnection) {
    super(squadTable, connection);
  }
}

class CrewRepository extends BaseRepository<CrewMember, "id"> {
  constructor(connection: DatabaseConnection) {
    super(crewTable, connection);
  }

  async attachSquads(
    members: readonly CrewMember[],
  ): Promise<Array<CrewMember & { squad?: Squad }>> {
    const squadsById = await this.loadBelongsToForParents(
      members,
      {
        type: "belongsTo",
        name: "squad",
        foreignKey: "squad_id",
        ownerKey: "id",
      },
      new SquadRepository(this.connection),
    );

    return members.map((member) => ({
      ...member,
      squad: squadsById.get(member.squad_id),
    }));
  }

  async loadBySquads(squads: readonly Squad[]) {
    return await this.loadHasManyForParents(squads, squadHasManyCrewMembers);
  }
}

describe("belongsTo eager loading", () => {
  test("loads parent records for child rows", async () => {
    const connection = new FakeConnection();
    const crewRepository = new CrewRepository(connection);
    const members: CrewMember[] = [
      { id: 1, name: "Ripley", squad_id: 10 },
      { id: 2, name: "Hicks", squad_id: 10 },
      { id: 3, name: "Bishop", squad_id: 20 },
    ];

    connection.queue([
      { id: 10, label: "Alpha" },
      { id: 20, label: "Beta" },
    ]);

    const withSquads = await crewRepository.attachSquads(members);

    expect(withSquads[0]?.squad).toEqual({ id: 10, label: "Alpha" });
    expect(withSquads[2]?.squad).toEqual({ id: 20, label: "Beta" });
    expect(connection.calls[0]?.params).toEqual([10, 20]);
  });

  test("indexes belongsTo relations by foreign key", () => {
    const members: CrewMember[] = [{ id: 1, name: "Ripley", squad_id: 10 }];
    const squads: Squad[] = [{ id: 10, label: "Alpha" }];

    const indexed = indexBelongsToRelation(members, squads, {
      type: "belongsTo",
      name: "squad",
      foreignKey: "squad_id",
      ownerKey: "id",
    });

    expect(indexed.get(10)).toEqual({ id: 10, label: "Alpha" });
  });
});

describe("hasMany eager loading", () => {
  test("preserves empty parent groups", async () => {
    const connection = new FakeConnection();
    const crewRepository = new CrewRepository(connection);
    const squads: Squad[] = [
      { id: 10, label: "Alpha" },
      { id: 20, label: "Beta" },
    ];

    connection.queue([]);

    const grouped = await crewRepository.loadBySquads(squads);

    expect(grouped.get(10)).toEqual([]);
    expect(grouped.get(20)).toEqual([]);
  });
});
