import { describe, expect, test } from "bun:test";
import { BaseRepository } from "@getstrata/core/database/baseRepository";
import { Model, registerModelRepository } from "@getstrata/core/database/model";
import { defineTable } from "@getstrata/core/database/table";

interface User {
  id: number;
  name: string;
}

interface Position {
  id: number;
  user_id: number | null;
  name: string;
}

interface Application {
  id: number;
  user_id: number;
  position_id: number;
  status_id: number;
}

interface Tag {
  id: number;
  name: string;
}

interface UserTag {
  user_id: number;
  tag_id: number;
}

const userTable = defineTable<User, "id">({
  name: "users",
  primaryKey: "id",
  columns: ["id", "name"],
});

const positionTable = defineTable<Position, "id">({
  name: "positions",
  primaryKey: "id",
  columns: ["id", "user_id", "name"],
});

const applicationTable = defineTable<Application, "id">({
  name: "applications",
  primaryKey: "id",
  columns: ["id", "user_id", "position_id", "status_id"],
});

const tagTable = defineTable<Tag, "id">({
  name: "tags",
  primaryKey: "id",
  columns: ["id", "name"],
});

class FakeConnection {
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

class UserRepository extends BaseRepository<User, "id"> {
  constructor(connection: FakeConnection) {
    super(userTable, connection);
  }
}

class PositionRepository extends BaseRepository<Position, "id"> {
  constructor(connection: FakeConnection) {
    super(positionTable, connection);
  }
}

class ApplicationRepository extends BaseRepository<Application, "id"> {
  constructor(connection: FakeConnection) {
    super(applicationTable, connection);
  }
}

class TagRepository extends BaseRepository<Tag, "id"> {
  constructor(connection: FakeConnection) {
    super(tagTable, connection);
  }
}

function createModels(connection: FakeConnection) {
  class ApplicationModel extends Model<Application, "id"> {
    static override $fillable = ["user_id", "position_id", "status_id"] as const;
    static override $timestamps = false;

    protected override primaryKey(): "id" {
      return "id";
    }

    user() {
      return this.belongsTo(UserModel);
    }

    position() {
      return this.belongsTo(PositionModel, "position_id");
    }
  }

  class PositionModel extends Model<Position, "id"> {
    static override $fillable = ["user_id", "name"] as const;
    static override $timestamps = false;

    protected override primaryKey(): "id" {
      return "id";
    }
  }

  class TagModel extends Model<Tag, "id"> {
    static override $fillable = ["name"] as const;
    static override $timestamps = false;

    protected override primaryKey(): "id" {
      return "id";
    }
  }

  class UserModel extends Model<User, "id"> {
    static override $fillable = ["name"] as const;
    static override $timestamps = false;

    protected override primaryKey(): "id" {
      return "id";
    }

    applications() {
      return this.hasMany(ApplicationModel);
    }

    position() {
      return this.hasOne(PositionModel);
    }

    tags() {
      return this.belongsToMany(TagModel, "user_tag");
    }
  }

  registerModelRepository(ApplicationModel, new ApplicationRepository(connection));
  registerModelRepository(PositionModel, new PositionRepository(connection));
  registerModelRepository(TagModel, new TagRepository(connection));
  registerModelRepository(UserModel, new UserRepository(connection));

  return { ApplicationModel, PositionModel, TagModel, UserModel };
}

describe("Eloquent-style model relations", () => {
  test("hasMany get/where/count/create/createMany use the inferred foreign key", async () => {
    const connection = new FakeConnection();
    const { UserModel, ApplicationModel } = createModels(connection);
    const user = new UserModel({ id: 7, name: "Ada" }, UserModel.repository());

    connection.queue([
      { id: 1, user_id: 7, position_id: 4, status_id: 1 },
      { id: 2, user_id: 7, position_id: 5, status_id: 2 },
    ]);
    const all = await user.applications().get();
    expect(all.map((row) => row.get("id"))).toEqual([1, 2]);
    expect(connection.calls[0]?.query).toContain('"user_id"');

    connection.queue([{ id: 2, user_id: 7, position_id: 5, status_id: 2 }]);
    const filtered = await user
      .applications()
      .where({ status_id: 2 })
      .orderBy({ status_id: "ASC" })
      .get();
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.get("status_id")).toBe(2);

    connection.queue([{ id: 1, user_id: 7, position_id: 4, status_id: 1 }]);
    expect(await user.applications().count()).toBe(1);

    connection.queue([{ id: 3, user_id: 7, position_id: 9, status_id: 1 }]);
    const created = await user.applications().create({ position_id: 9, status_id: 1 });
    expect(created.get("user_id")).toBe(7);
    expect(created).toBeInstanceOf(ApplicationModel);

    connection.queue([{ id: 4, user_id: 7, position_id: 1, status_id: 1 }]);
    connection.queue([{ id: 5, user_id: 7, position_id: 2, status_id: 1 }]);
    const many = await user.applications().createMany([
      { position_id: 1, status_id: 1 },
      { position_id: 2, status_id: 1 },
    ]);
    expect(many).toHaveLength(2);
  });

  test("hasMany first() returns one related model", async () => {
    const connection = new FakeConnection();
    const { UserModel } = createModels(connection);
    const user = new UserModel({ id: 1, name: "Ada" }, UserModel.repository());

    connection.queue([{ id: 10, user_id: 1, position_id: 4, status_id: 1 }]);
    const first = await user.applications().first();
    expect(first?.id).toBe(10);

    connection.queue([]);
    expect(await user.applications().first()).toBeNull();
  });

  test("hasOne get/create and load/loaded", async () => {
    const connection = new FakeConnection();
    const { UserModel, PositionModel } = createModels(connection);
    const user = new UserModel({ id: 3, name: "Recruiter" }, UserModel.repository());

    connection.queue([{ id: 8, user_id: 3, name: "Engineer" }]);
    const position = await user.position().get();
    expect(position?.get("name")).toBe("Engineer");
    connection.queue([{ id: 8, user_id: 3, name: "Engineer" }]);
    expect(await user.position().count()).toBe(1);
    connection.queue([{ id: 8, user_id: 3, name: "Engineer" }]);
    expect(await user.position().first()).not.toBeNull();

    connection.queue([]);
    expect(await user.position().get()).toBeNull();
    connection.queue([]);
    expect(await user.position().count()).toBe(0);

    connection.queue([{ id: 9, user_id: 3, name: "Lead" }]);
    const created = await user.position().create({ name: "Lead" });
    expect(created).toBeInstanceOf(PositionModel);
    expect(created.get("user_id")).toBe(3);

    connection.queue([{ id: 8, user_id: 3, name: "Engineer" }]);
    await user.load("position");
    expect(user.loaded<{ get: (key: "name") => string }>("position")?.get("name")).toBe("Engineer");

    connection.queue([{ id: 8, user_id: 3, name: "Engineer" }]);
    await user.position().where({ name: "Engineer" }).orderBy({ name: "ASC" }).get();

    const relation = user.position();
    expect(relation.hydrateEager({ position: { id: 8 } }, "position")).toEqual({ id: 8 });
    expect(relation.hydrateEager({ position: [] }, "position")).toBeUndefined();
  });

  test("belongsTo get/associate/dissociate", async () => {
    const connection = new FakeConnection();
    const { ApplicationModel, UserModel } = createModels(connection);
    const application = new ApplicationModel(
      { id: 11, user_id: 7, position_id: 4, status_id: 1 },
      ApplicationModel.repository(),
    );

    connection.queue([{ id: 7, name: "Ada" }]);
    const owner = await application.user().get();
    expect(owner?.get("name")).toBe("Ada");
    connection.queue([{ id: 7, name: "Ada" }]);
    expect(await application.user().first()).not.toBeNull();

    const orphan = new ApplicationModel(
      { id: 12, user_id: null as unknown as number, position_id: 4, status_id: 1 },
      ApplicationModel.repository(),
    );
    expect(await orphan.user().get()).toBeNull();

    connection.queue([{ id: 11 }]);
    await application.user().associate({ id: 2 });
    expect(connection.calls.at(-1)?.query).toContain("UPDATE");
    expect(connection.calls.at(-1)?.params).toContain(2);

    connection.queue([{ id: 11 }]);
    const ada = new UserModel({ id: 7, name: "Ada" }, UserModel.repository());
    await application.user().associate(ada);
    expect(connection.calls.at(-1)?.params).toContain(7);

    connection.queue([{ id: 11 }]);
    await application.user().dissociate();
    expect(connection.calls.at(-1)?.params).toContain(null);

    await expect(application.user().associate({} as { id?: unknown })).rejects.toThrow(
      "belongsTo.associate() requires a related model or { id }.",
    );
  });

  test("belongsToMany get/attach/detach/sync/create", async () => {
    const connection = new FakeConnection();
    const { UserModel, TagModel } = createModels(connection);
    const user = new UserModel({ id: 1, name: "Ada" }, UserModel.repository());

    connection.queue([]);
    expect(await user.tags().get()).toEqual([]);
    expect(await user.tags().count()).toBe(0);
    expect(await user.tags().first()).toBeNull();

    connection.queue([
      { user_id: 1, tag_id: 10 } as UserTag,
      { user_id: 1, tag_id: 20 } as UserTag,
    ]);
    connection.queue([
      { id: 10, name: "bun" },
      { id: 20, name: "laravel" },
    ]);
    const tags = await user.tags().where({}).orderBy({ name: "ASC" }).get();
    expect(tags.map((tag) => tag.get("name"))).toEqual(["bun", "laravel"]);

    await user.tags().attach(30);
    expect(connection.calls.at(-1)?.query).toContain("INSERT");
    await user.tags().attach([31, 32]);
    expect(connection.calls.at(-1)?.params).toEqual([1, 32]);

    await user.tags().detach();
    expect(connection.calls.at(-1)?.query).toContain("DELETE");
    await user.tags().detach(30);
    expect(connection.calls.at(-1)?.query).toContain("ANY");
    await user.tags().detach([31]);

    await user.tags().sync([]);
    await user.tags().sync([10]);
    expect(connection.calls.at(-1)?.query).toContain("INSERT");

    connection.queue([{ id: 40, name: "htmx" }]);
    const created = await user.tags().create({ name: "htmx" });
    expect(created).toBeInstanceOf(TagModel);
    expect(connection.calls.at(-1)?.query).toContain("INSERT INTO user_tag");
  });

  test("load and Model.with eager-load relation methods", async () => {
    const connection = new FakeConnection();
    const { UserModel } = createModels(connection);
    const user = new UserModel({ id: 1, name: "Ada" }, UserModel.repository());

    connection.queue([{ id: 1, user_id: 1, position_id: 4, status_id: 1 }]);
    await user.load("applications");
    expect(user.loaded<Array<{ id: unknown }>>("applications")?.[0]?.id).toBe(1);

    await expect(user.load("missing")).rejects.toThrow("has no relation method missing()");

    connection.queue([{ id: 1, name: "Ada" }]);
    connection.queue([{ id: 1, user_id: 1, position_id: 4, status_id: 1 }]);
    const loaded = await UserModel.with("applications").get();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.loaded<unknown[]>("applications")).toHaveLength(1);

    connection.queue([{ id: 1, name: "Ada" }]);
    connection.queue([{ id: 8, user_id: 1, name: "Engineer" }]);
    const first = await UserModel.with("position").first();
    expect(first?.loaded<{ name?: string } | undefined>("position")).toBeDefined();

    connection.queue([{ id: 1, name: "Ada" }]);
    connection.queue([{ user_id: 1, tag_id: 10 }]);
    connection.queue([{ id: 10, name: "bun" }]);
    const withTags = await UserModel.with("tags").get();
    expect(withTags[0]?.loaded<unknown[]>("tags")).toHaveLength(1);

    connection.queue([{ id: 11, user_id: 1, position_id: 4, status_id: 1 }]);
    connection.queue([{ id: 1, name: "Ada" }]);
    const { ApplicationModel } = createModels(connection);
    const withUser = await ApplicationModel.with("user").first();
    expect(withUser?.loaded<{ name?: string }>("user") ?? withUser?.loaded("user")).toBeDefined();

    expect(() => UserModel.with("nope")).toThrow("has no relation method nope()");

    const tagsRelation = user.tags();
    tagsRelation.applyEagerLoad(UserModel.query(), "tags");
    expect(tagsRelation.hydrateEager({}, "tags")).toEqual([]);
    expect(user.applications().hydrateEager({}, "applications")).toEqual([]);
  });

  test("belongsTo orderBy is applied when present", async () => {
    const connection = new FakeConnection();
    const { ApplicationModel } = createModels(connection);
    const application = new ApplicationModel(
      { id: 1, user_id: 7, position_id: 4, status_id: 1 },
      ApplicationModel.repository(),
    );

    connection.queue([{ id: 7, name: "Ada" }]);
    await application.user().orderBy({ name: "DESC" }).get();
    expect(connection.calls[0]?.query.toLowerCase()).toContain("order");
  });
});
