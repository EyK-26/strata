import { describe, expect, test } from "bun:test";
import { BaseRepository, type DatabaseConnection } from "@getstrata/core/database/baseRepository";
import { Model, registerModelRepository } from "@getstrata/core/database/model";
import { quoteIdentifier } from "@getstrata/core/database/query";
import { hasMany } from "@getstrata/core/database/relationships";
import { projectPluck, uniqueColumnSelect } from "@getstrata/core/database/repositoryQuery";
import { defineTable } from "@getstrata/core/database/table";

type Squad = { id: number; label: string | null; active: boolean };
type Member = { id: number; name: string; squad_id: number | null };
type SoftSquad = { id: number; label: string; deleted_at: Date | null };
type Article = {
  id: number;
  title: string;
  meta: Record<string, unknown> | null;
  published: boolean;
  views: number | null;
  created_at: Date;
  secret: string;
};
type Tag = { id: number; name: string };
type UserTag = { user_id: number; tag_id: number };
type Application = { id: number; title: string; position_id: number };
type Department = { id: number; name: string };
type Image = {
  id: number;
  imageable_type: string;
  imageable_id: number | null;
  url: string;
};

const squadTable = defineTable<Squad, "id">({
  name: "squad",
  primaryKey: "id",
  columns: ["id", "label", "active"],
});

const memberTable = defineTable<Member, "id">({
  name: "member",
  primaryKey: "id",
  columns: ["id", "name", "squad_id"],
});

const softSquadTable = defineTable<SoftSquad, "id">({
  name: "soft_squad",
  primaryKey: "id",
  columns: ["id", "label", "deleted_at"],
  softDeletes: true,
});

const articleTable = defineTable<Article, "id">({
  name: "articles",
  primaryKey: "id",
  columns: ["id", "title", "meta", "published", "views", "created_at", "secret"],
});

const tagTable = defineTable<Tag, "id">({
  name: "tags",
  primaryKey: "id",
  columns: ["id", "name"],
});

const applicationTable = defineTable<Application, "id">({
  name: "applications",
  primaryKey: "id",
  columns: ["id", "title", "position_id"],
});

const departmentTable = defineTable<Department, "id">({
  name: "departments",
  primaryKey: "id",
  columns: ["id", "name"],
});

const imageTable = defineTable<Image, "id">({
  name: "images",
  primaryKey: "id",
  columns: ["id", "imageable_type", "imageable_id", "url"],
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

class SoftSquadRepository extends BaseRepository<SoftSquad, "id"> {
  constructor(connection: DatabaseConnection) {
    super(softSquadTable, connection);
  }
}

const squadHasMembers = hasMany<Squad, Member, "id", "squad_id">({
  name: "members",
  localKey: "id",
  foreignKey: "squad_id",
});

describe("projectPluck", () => {
  test("extracts a column, keeps nulls and zeros, and keys by Map with last-write-wins", () => {
    const rows = [
      { id: 1, label: "Alpha", active: true },
      { id: 2, label: null, active: false },
      { id: 1, label: "Replaced", active: true },
      { id: 0, label: "", active: false },
    ] as const;

    expect(projectPluck(rows, "label")).toEqual(["Alpha", null, "Replaced", ""]);
    expect(projectPluck(rows, "id")).toEqual([1, 2, 1, 0]);
    expect(projectPluck(rows, "active")).toEqual([true, false, true, false]);

    const keyed = projectPluck(rows, "label", "id");
    expect(keyed).toBeInstanceOf(Map);
    expect([...keyed.entries()]).toEqual([
      [1, "Replaced"],
      [2, null],
      [0, ""],
    ]);
  });

  test("returns empty arrays and maps for no rows, including null keys", () => {
    expect(projectPluck([] as Array<{ id: number; label: string }>, "label")).toEqual([]);
    expect(projectPluck([] as Array<{ id: number; label: string }>, "label", "id").size).toBe(0);

    const keyed = projectPluck(
      [
        { id: null as number | null, label: "orphan" },
        { id: null as number | null, label: "later" },
      ],
      "label",
      "id",
    );
    expect(keyed.get(null)).toBe("later");
  });
});

describe("uniqueColumnSelect", () => {
  test("aliases columns and drops duplicates so keyed pluck can reuse the value column", () => {
    expect(uniqueColumnSelect("squad", ["label", "id", "label"])).toEqual([
      { kind: "column", table: "squad", column: "label", as: "label" },
      { kind: "column", table: "squad", column: "id", as: "id" },
    ]);
    expect(uniqueColumnSelect("squad", [])).toEqual([]);
  });
});

describe("RepositoryQuery pluck and value", () => {
  test("selects only the plucked column and skips eager loads", async () => {
    const connection = new FakeConnection();
    const squads = new SquadRepository(connection);
    const members = new MemberRepository(connection);

    connection.queue([{ label: "Alpha" }, { label: "Bravo" }]);

    const labels = await squads
      .query()
      .orderBy({ id: "asc" })
      .withHasMany("members", squadHasMembers, members)
      .pluck("label");

    expect(labels).toEqual(["Alpha", "Bravo"]);
    expect(connection.calls).toHaveLength(1);
    expect(connection.calls[0]?.query).toContain('SELECT "squad"."label" AS "label" FROM "squad"');
    expect(connection.calls[0]?.query).not.toContain('"squad"."active"');
    expect(connection.calls[0]?.query).not.toContain('"squad"."label",');
  });

  test("keyed pluck returns a Map, dedupes the same column, and last duplicate key wins", async () => {
    const connection = new FakeConnection();
    const squads = new SquadRepository(connection);

    connection.queue([
      { label: "Alpha", id: 1 },
      { label: "Bravo", id: 1 },
    ]);
    const keyed = await squads.query().pluck("label", "id");
    expect([...keyed.entries()]).toEqual([[1, "Bravo"]]);

    connection.queue([{ id: 4 }]);
    const sameColumn = await squads.query().pluck("id", "id");
    expect(sameColumn.get(4)).toBe(4);
    expect(connection.calls.at(-1)?.query).toContain('SELECT "squad"."id" AS "id" FROM "squad"');
    expect((connection.calls.at(-1)?.query.match(/"squad"\."id"/g) ?? []).length).toBe(1);
  });

  test("applies where, limit, offset, and does not mutate a later get()", async () => {
    const connection = new FakeConnection();
    const squads = new SquadRepository(connection);
    const query = squads
      .query()
      .where({ active: true })
      .orderBy({ label: "asc" })
      .offset(1)
      .limit(2);

    connection.queue([{ label: "Bravo" }]);
    expect(await query.pluck("label")).toEqual(["Bravo"]);
    expect(connection.calls[0]?.query).toContain("LIMIT 2");
    expect(connection.calls[0]?.query).toContain("OFFSET 1");
    expect(connection.calls[0]?.query).toContain('"active"');

    connection.queue([{ id: 2, label: "Bravo", active: true }]);
    const rows = await query.get();
    expect(rows[0]).toEqual({ id: 2, label: "Bravo", active: true });
    expect(connection.calls[1]?.query).toContain('"squad"."id"');
    expect(connection.calls[1]?.query).toContain('"squad"."label"');
    expect(connection.calls[1]?.query).toContain('"squad"."active"');
  });

  test("value reads one column from the first row without mutating limit for later get()", async () => {
    const connection = new FakeConnection();
    const squads = new SquadRepository(connection);
    const query = squads.query().orderBy({ id: "asc" });

    connection.queue([{ label: "Alpha" }]);
    expect(await query.value("label")).toBe("Alpha");
    expect(connection.calls[0]?.query).toContain("LIMIT 1");
    expect(connection.calls[0]?.query).toContain('SELECT "squad"."label" AS "label"');

    connection.queue([
      { id: 1, label: "Alpha", active: true },
      { id: 2, label: "Bravo", active: true },
    ]);
    expect(await query.get()).toHaveLength(2);
    expect(connection.calls[1]?.query).not.toContain("LIMIT 1");
  });

  test("value keeps 0, false, and empty string, and returns null when missing or SQL-null", async () => {
    const connection = new FakeConnection();
    const squads = new SquadRepository(connection);

    connection.queue([]);
    expect(await squads.query().value("label")).toBeNull();

    connection.queue([{ label: null }]);
    expect(await squads.query().value("label")).toBeNull();

    connection.queue([{ active: false }]);
    expect(await squads.query().value("active")).toBe(false);

    connection.queue([{ id: 0 }]);
    expect(await squads.query().value("id")).toBe(0);

    connection.queue([{ label: "" }]);
    expect(await squads.query().value("label")).toBe("");
  });

  test("empty pluck results, joins, and invalid identifiers", async () => {
    const connection = new FakeConnection();
    const squads = new SquadRepository(connection);

    connection.queue([]);
    expect(await squads.query().pluck("label")).toEqual([]);
    expect((await squads.query().pluck("label", "id")).size).toBe(0);

    connection.queue([]);
    await squads.query().join("member.squad_id", "squad.id").pluck("label");
    expect(connection.calls.at(-1)?.query).toContain("INNER JOIN");
    expect(connection.calls.at(-1)?.query).toContain('SELECT "squad"."label" AS "label"');

    expect(() => quoteIdentifier("label;drop")).toThrow("Invalid SQL identifier");
    await expect(squads.query().pluck("label;drop" as never)).rejects.toThrow(
      "Internal server error.",
    );
  });

  test("soft-delete scope applies unless withTrashed, and onlyTrashed inverts it", async () => {
    const connection = new FakeConnection();
    const squads = new SoftSquadRepository(connection);

    connection.queue([]);
    await squads.query().pluck("label");
    expect(connection.calls.at(-1)?.query).toContain('"deleted_at" IS NULL');

    connection.queue([]);
    await squads.query().withTrashed().pluck("label");
    expect(connection.calls.at(-1)?.query).not.toContain("deleted_at");

    connection.queue([]);
    await squads.query().onlyTrashed().value("label");
    expect(connection.calls.at(-1)?.query).toContain('"deleted_at" IS NOT NULL');
  });
});

describe("ModelQuery pluck, value, and count", () => {
  test("casts values, skips retrieved observers, and honors global scopes", async () => {
    const connection = new FakeConnection();
    const retrieved: number[] = [];

    class ArticleModel extends Model<Article, "id"> {
      static override $timestamps = false;
      static override $fillable = ["title", "meta", "published", "views", "secret"] as const;
      static override $casts = {
        meta: "json",
        published: "bool",
        views: "integer",
        created_at: "datetime",
        secret: "hashed",
      } as const;

      static override boot(): void {
        ArticleModel.addGlobalScope("publishedOnly", (query) => query.where({ published: true }));
      }

      protected override primaryKey(): "id" {
        return "id";
      }
    }

    registerModelRepository(
      ArticleModel,
      new (class extends BaseRepository<Article, "id"> {
        constructor() {
          super(articleTable, connection);
        }
      })(),
    );

    ArticleModel.observe({
      retrieved: () => {
        retrieved.push(1);
      },
    });

    connection.queue([
      {
        title: "Live",
        meta: '{"tags":["a"]}',
        published: "1",
        views: "4",
        created_at: "2026-01-01T00:00:00.000Z",
        secret: "hash",
        id: "9",
      },
    ]);
    expect(await ArticleModel.query().pluck("title")).toEqual(["Live"]);
    expect(retrieved).toEqual([]);
    expect(connection.calls[0]?.query).toContain('"published"');

    connection.queue([
      {
        title: "Live",
        meta: '{"tags":["a"]}',
        published: "true",
        views: "",
        created_at: "2026-01-01T00:00:00.000Z",
        secret: "hash",
        id: 9,
      },
    ]);
    const keyed = await ArticleModel.pluck("meta", "id");
    expect(keyed.get(9)).toEqual({ tags: ["a"] });

    connection.queue([{ published: "0" }]);
    expect(await ArticleModel.query().value("published")).toBe(false);

    connection.queue([{ views: "" }]);
    expect(await ArticleModel.value("views")).toBeNull();

    connection.queue([{ created_at: "2026-01-01T00:00:00.000Z" }]);
    expect(await ArticleModel.query().value("created_at")).toEqual(
      new Date("2026-01-01T00:00:00.000Z"),
    );

    connection.queue([{ secret: "hash" }]);
    expect(await ArticleModel.query().value("secret")).toBe("hash");

    connection.queue([{ count: 3 }]);
    expect(await ArticleModel.count()).toBe(3);
    expect(connection.calls.at(-1)?.query).toContain("COUNT(*)");
    expect(connection.calls.at(-1)?.query).toContain('"published"');

    connection.queue([
      {
        id: 1,
        title: "Live",
        meta: null,
        published: true,
        views: 1,
        created_at: new Date("2026-01-01T00:00:00.000Z"),
        secret: "hash",
      },
    ]);
    await ArticleModel.query().get();
    expect(retrieved).toEqual([1]);
  });
});

describe("relation query pluck and value", () => {
  function createGraph(connection: FakeConnection) {
    class TagModel extends Model<Tag, "id"> {
      static override $timestamps = false;
      static override $fillable = ["name"] as const;
      protected override primaryKey(): "id" {
        return "id";
      }
    }

    class MemberModel extends Model<Member, "id"> {
      static override $timestamps = false;
      static override $fillable = ["name", "squad_id"] as const;
      protected override primaryKey(): "id" {
        return "id";
      }

      squad() {
        return this.belongsTo(SquadModel);
      }

      tags() {
        return this.belongsToMany(TagModel, "user_tag", "user_id", "tag_id");
      }
    }

    class SquadModel extends Model<Squad, "id"> {
      static override $timestamps = false;
      static override $fillable = ["label", "active"] as const;
      protected override primaryKey(): "id" {
        return "id";
      }

      members() {
        return this.hasMany(MemberModel);
      }

      captain() {
        return this.hasOne(MemberModel);
      }
    }

    class ApplicationModel extends Model<Application, "id"> {
      static override $timestamps = false;
      static override $fillable = ["title", "position_id"] as const;
      protected override primaryKey(): "id" {
        return "id";
      }
    }

    class DepartmentModel extends Model<Department, "id"> {
      static override $timestamps = false;
      static override $fillable = ["name"] as const;
      protected override primaryKey(): "id" {
        return "id";
      }

      applications() {
        return this.hasManyThrough(ApplicationModel, SquadModel);
      }
    }

    class ImageModel extends Model<Image, "id"> {
      static override $timestamps = false;
      static override $fillable = ["imageable_type", "imageable_id", "url"] as const;
      protected override primaryKey(): "id" {
        return "id";
      }

      imageable() {
        return this.morphTo({ squads: SquadModel }, "imageable");
      }
    }

    class PicturedSquad extends SquadModel {
      static override $morphClass = "squads";
      images() {
        return this.morphMany(ImageModel, "imageable");
      }
      avatar() {
        return this.morphOne(ImageModel, "imageable");
      }
    }

    registerModelRepository(
      TagModel,
      new (class extends BaseRepository<Tag, "id"> {
        constructor() {
          super(tagTable, connection);
        }
      })(),
    );
    registerModelRepository(MemberModel, new MemberRepository(connection));
    registerModelRepository(SquadModel, new SquadRepository(connection));
    registerModelRepository(
      ApplicationModel,
      new (class extends BaseRepository<Application, "id"> {
        constructor() {
          super(applicationTable, connection);
        }
      })(),
    );
    registerModelRepository(
      DepartmentModel,
      new (class extends BaseRepository<Department, "id"> {
        constructor() {
          super(departmentTable, connection);
        }
      })(),
    );
    registerModelRepository(
      ImageModel,
      new (class extends BaseRepository<Image, "id"> {
        constructor() {
          super(imageTable, connection);
        }
      })(),
    );
    registerModelRepository(PicturedSquad, SquadModel.repository());

    return {
      ApplicationModel,
      DepartmentModel,
      ImageModel,
      MemberModel,
      PicturedSquad,
      SquadModel,
      TagModel,
    };
  }

  test("hasMany and hasOne pluck a related column and value", async () => {
    const connection = new FakeConnection();
    const { SquadModel } = createGraph(connection);
    const squad = new SquadModel({ id: 1, label: "Alpha", active: true }, SquadModel.repository());

    connection.queue([{ name: "Ripley" }, { name: "Hicks" }]);
    expect(await squad.members().orderBy({ name: "ASC" }).pluck("name")).toEqual([
      "Ripley",
      "Hicks",
    ]);
    expect(connection.calls.at(-1)?.query).toContain('SELECT "member"."name" AS "name"');
    expect(connection.calls.at(-1)?.query).toContain('"squad_id"');

    connection.queue([{ name: "Ripley", id: 10 }]);
    expect([...(await squad.members().pluck("name", "id")).entries()]).toEqual([[10, "Ripley"]]);

    connection.queue([{ name: "Ripley" }]);
    expect(await squad.members().value("name")).toBe("Ripley");

    connection.queue([{ name: "Ripley" }]);
    expect(await squad.captain().pluck("name")).toEqual(["Ripley"]);
    expect(connection.calls.at(-1)?.query).toContain("LIMIT 1");

    connection.queue([{ name: "Ripley" }]);
    expect(await squad.captain().value("name")).toBe("Ripley");
  });

  test("belongsTo pluck/value skip the query when the foreign key is missing", async () => {
    const connection = new FakeConnection();
    const { MemberModel } = createGraph(connection);
    const orphan = new MemberModel(
      { id: 1, name: "Newt", squad_id: null },
      MemberModel.repository(),
    );
    expect(await orphan.squad().pluck("label")).toEqual([]);
    expect((await orphan.squad().pluck("label", "id")).size).toBe(0);
    expect(await orphan.squad().value("label")).toBeNull();
    expect(connection.calls).toHaveLength(0);

    const member = new MemberModel(
      { id: 2, name: "Ripley", squad_id: 1 },
      MemberModel.repository(),
    );
    connection.queue([{ label: "Alpha" }]);
    expect(
      await member.squad().where({ active: true }).orderBy({ label: "ASC" }).pluck("label"),
    ).toEqual(["Alpha"]);
    connection.queue([{ label: "Alpha" }]);
    expect(await member.squad().value("label")).toBe("Alpha");
  });

  test("belongsToMany pluck uses pivot ids and returns empty without a related query", async () => {
    const connection = new FakeConnection();
    const { MemberModel } = createGraph(connection);
    const member = new MemberModel({ id: 1, name: "Ada", squad_id: 1 }, MemberModel.repository());

    connection.queue([]);
    expect(await member.tags().pluck("name")).toEqual([]);
    expect(connection.calls).toHaveLength(1);

    connection.queue([]);
    expect(await member.tags().value("name")).toBeNull();

    connection.queue([
      { user_id: 1, tag_id: 10 } as UserTag,
      { user_id: 1, tag_id: 20 } as UserTag,
    ]);
    connection.queue([{ name: "bun" }, { name: "strata" }]);
    expect(await member.tags().where({}).orderBy({ name: "ASC" }).pluck("name")).toEqual([
      "bun",
      "strata",
    ]);
    expect(connection.calls.at(-1)?.query).toContain('SELECT "tags"."name" AS "name"');

    connection.queue([{ user_id: 1, tag_id: 10 } as UserTag]);
    connection.queue([{ name: "bun", id: 10 }]);
    expect((await member.tags().pluck("name", "id")).get(10)).toBe("bun");

    connection.queue([{ user_id: 1, tag_id: 10 } as UserTag]);
    connection.queue([{ name: "bun" }]);
    expect(await member.tags().value("name")).toBe("bun");
  });

  test("morphMany, morphOne, and morphTo pluck related columns", async () => {
    const connection = new FakeConnection();
    const { ImageModel, PicturedSquad } = createGraph(connection);
    const squad = new PicturedSquad(
      { id: 4, label: "Alpha", active: true },
      PicturedSquad.repository(),
    );

    connection.queue([{ url: "/a.png" }]);
    expect(await squad.images().pluck("url")).toEqual(["/a.png"]);
    expect(connection.calls.at(-1)?.query).toContain("imageable_type");

    connection.queue([{ url: "/a.png", id: 1 }]);
    expect((await squad.images().pluck("url", "id")).get(1)).toBe("/a.png");

    connection.queue([{ url: "/a.png" }]);
    expect(await squad.images().value("url")).toBe("/a.png");

    connection.queue([{ url: "/b.png" }]);
    expect(await squad.avatar().pluck("url")).toEqual(["/b.png"]);
    connection.queue([{ url: "/b.png" }]);
    expect(await squad.avatar().value("url")).toBe("/b.png");

    const image = new ImageModel(
      { id: 3, imageable_type: "squads", imageable_id: 4, url: "/c.png" },
      ImageModel.repository(),
    );
    connection.queue([{ label: "Alpha" }]);
    expect(await image.imageable().pluck("label")).toEqual(["Alpha"]);
    connection.queue([{ label: "Alpha" }]);
    expect(await image.imageable().value("label")).toBe("Alpha");

    const missingType = new ImageModel(
      { id: 4, imageable_type: "unknown", imageable_id: 4, url: "/d.png" },
      ImageModel.repository(),
    );
    expect(await missingType.imageable().pluck("label")).toEqual([]);
    expect(await missingType.imageable().value("label")).toBeNull();

    const missingId = new ImageModel(
      { id: 5, imageable_type: "squads", imageable_id: null, url: "/e.png" },
      ImageModel.repository(),
    );
    expect(await missingId.imageable().pluck("label", "id")).toEqual(new Map());
    expect(await missingId.imageable().value("label")).toBeNull();
  });

  test("hasManyThrough plucks far columns without hydrating models", async () => {
    const connection = new FakeConnection();
    const { DepartmentModel } = createGraph(connection);
    const department = new DepartmentModel(
      { id: 1, name: "Engineering" },
      DepartmentModel.repository(),
    );

    connection.queue([
      { id: 10, title: "A", position_id: 4, __through_parent_id: 1 },
      { id: 11, title: "B", position_id: 5, __through_parent_id: 1 },
    ]);
    expect(await department.applications().pluck("title")).toEqual(["A", "B"]);

    connection.queue([{ id: 10, title: "A", position_id: 4, __through_parent_id: 1 }]);
    expect((await department.applications().pluck("title", "id")).get(10)).toBe("A");

    connection.queue([{ id: 10, title: "A", position_id: 4, __through_parent_id: 1 }]);
    expect(await department.applications().value("title")).toBe("A");

    connection.queue([]);
    expect(await department.applications().value("title")).toBeNull();
  });
});
