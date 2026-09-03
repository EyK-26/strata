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

    connection.queue([{ count: 1 }]);
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
    connection.queue([{ count: 1 }]);
    expect(await user.position().count()).toBe(1);
    connection.queue([{ id: 8, user_id: 3, name: "Engineer" }]);
    expect(await user.position().first()).not.toBeNull();

    connection.queue([]);
    expect(await user.position().get()).toBeNull();
    connection.queue([{ count: 0 }]);
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
    expect(
      (
        relation.hydrateEager({ position: [{ id: 8, user_id: 3, name: "X" }] }, "position") as {
          id: number;
        }
      )?.id,
    ).toBe(8);
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
    tagsRelation.applyEagerLoad(UserModel.query().query, "tags");
    expect(tagsRelation.hydrateEager({}, "tags")).toEqual([]);
    expect(user.applications().hydrateEager({}, "applications")).toEqual([]);
  });

  test("toArray, observers, whereHas, morph, and nested load", async () => {
    const connection = new FakeConnection();
    const { UserModel, ApplicationModel, PositionModel } = createModels(connection);

    class VisibleUser extends UserModel {
      static override $hidden = ["name"];
      getInitialAttribute() {
        return "A";
      }
    }
    registerModelRepository(VisibleUser, UserModel.repository());

    const user = new VisibleUser({ id: 1, name: "Ada" }, VisibleUser.repository());
    expect(user.toArray()).toEqual({ id: 1 });
    user.append("initial").makeVisible("name");
    expect(user.toJSON().initial).toBe("A");
    user.makeHidden("id");
    expect(user.toArray().id).toBeUndefined();

    const hooks: string[] = [];
    UserModel.observe({
      creating: () => {
        hooks.push("creating");
      },
      created: () => {
        hooks.push("created");
      },
      deleting: () => false,
    });
    connection.queue([{ id: 9, name: "New" }]);
    await UserModel.create({ name: "New" });
    expect(hooks).toEqual(["creating", "created"]);
    const doomed = new UserModel({ id: 1, name: "Ada" }, UserModel.repository());
    expect(await doomed.delete()).toBeFalse();

    connection.queue([]);
    await UserModel.whereHas("applications", (query) => {
      query.where?.({ status_id: 1 });
    }).get();
    expect(connection.calls.at(-1)?.query).toContain("EXISTS");

    connection.queue([]);
    await UserModel.has("applications").get();
    expect(connection.calls.at(-1)?.query).toContain("EXISTS");

    connection.queue([]);
    await UserModel.doesntHave("applications").get();
    expect(connection.calls.at(-1)?.query).toContain("NOT EXISTS");

    connection.queue([]);
    await UserModel.whereDoesntHave("position").get();
    expect(connection.calls.at(-1)?.query).toContain("NOT EXISTS");

    connection.queue([]);
    await ApplicationModel.has("user").get();
    expect(connection.calls.at(-1)?.query).toContain("EXISTS");

    connection.queue([]);
    await UserModel.whereHas("tags", (query) => {
      query.where?.({ name: "bun" });
    }).get();
    expect(connection.calls.at(-1)?.query).toContain("user_tag");

    expect(() => UserModel.has("missing")).toThrow("has no relation method missing()");

    class ImageModel extends Model<
      { id: number; imageable_type: string; imageable_id: number; url: string },
      "id"
    > {
      static override $timestamps = false;
      static override $fillable = ["imageable_type", "imageable_id", "url"] as const;
      protected override primaryKey(): "id" {
        return "id";
      }
    }

    const imageTable = defineTable<
      { id: number; imageable_type: string; imageable_id: number; url: string },
      "id"
    >({
      name: "images",
      primaryKey: "id",
      columns: ["id", "imageable_type", "imageable_id", "url"],
    });
    class ImageRepository extends BaseRepository<
      { id: number; imageable_type: string; imageable_id: number; url: string },
      "id"
    > {
      constructor() {
        super(imageTable, connection);
      }
    }
    registerModelRepository(ImageModel, new ImageRepository());

    class PicturedUser extends UserModel {
      static override $morphClass = "users";
      images() {
        return this.morphMany(ImageModel, "imageable");
      }
      avatar() {
        return this.morphOne(ImageModel, "imageable");
      }
    }
    registerModelRepository(PicturedUser, UserModel.repository());

    const pictured = new PicturedUser({ id: 4, name: "Ada" }, PicturedUser.repository());
    connection.queue([{ id: 1, imageable_type: "users", imageable_id: 4, url: "/a.png" }]);
    const images = await pictured.images().get();
    expect(images[0]?.get("url")).toBe("/a.png");
    connection.queue([{ id: 2, imageable_type: "users", imageable_id: 4, url: "/b.png" }]);
    expect((await pictured.avatar().create({ url: "/b.png" })).get("url")).toBe("/b.png");

    connection.queue([{ id: 1, user_id: 1, position_id: 4, status_id: 1 }]);
    connection.queue([{ id: 4, user_id: 1, name: "Engineer" }]);
    await user.load("applications.position");
    expect(user.loaded<unknown[]>("applications")).toHaveLength(1);

    class ImageableModel extends ImageModel {
      imageable() {
        return this.morphTo({ users: PicturedUser }, "imageable");
      }
    }
    registerModelRepository(ImageableModel, ImageModel.repository());

    const image = new ImageableModel(
      { id: 3, imageable_type: "users", imageable_id: 4, url: "/c.png" },
      ImageableModel.repository(),
    );
    connection.queue([{ id: 4, name: "Ada" }]);
    expect((await image.imageable().get())?.get("name")).toBe("Ada");

    const missingType = new ImageableModel(
      { id: 4, imageable_type: "unknown", imageable_id: 4, url: "/d.png" },
      ImageableModel.repository(),
    );
    expect(await missingType.imageable().get()).toBeNull();
    expect(missingType.imageable().toExistsClause("images").sql).toContain("1 = 0");

    const missingId = new ImageableModel(
      { id: 5, imageable_type: "users", imageable_id: null as unknown as number, url: "/e.png" },
      ImageableModel.repository(),
    );
    expect(await missingId.imageable().get()).toBeNull();

    connection.queue([{ id: 4, name: "Ada" }]);
    connection.queue([{ id: 1, imageable_type: "users", imageable_id: 4, url: "/a.png" }]);
    const withImages = await PicturedUser.with("images").get();
    expect(withImages[0]?.loaded<unknown[]>("images")).toHaveLength(1);
    expect(pictured.images().hydrateEager({}, "images")).toEqual([]);
    expect(pictured.avatar().hydrateEager({}, "avatar")).toBeUndefined();
    expect(image.imageable().hydrateEager({ reactable: { id: 1 } }, "reactable")).toEqual({
      id: 1,
    });

    pictured.images().applyEagerLoad(PicturedUser.query().query, "images");
    pictured.avatar().where({ url: "/a.png" }).applyEagerLoad(PicturedUser.query().query, "avatar");
    image.imageable().applyEagerLoad(ImageableModel.query().query, "imageable");
    connection.queue([]);
    expect(await pictured.avatar().get()).toBeNull();
    connection.queue([]);
    expect(await pictured.images().first()).toBeNull();

    connection.queue([]);
    await ImageableModel.has("imageable").get();
    expect(connection.calls.at(-1)?.query).toContain("EXISTS");

    connection.queue([]);
    await PicturedUser.whereHas("images", (query) => {
      query.where?.({ url: "/a.png" });
    }).get();
    expect(connection.calls.at(-1)?.query).toContain("imageable_type");

    connection.queue([{ id: 1, name: "Ada" }]);
    expect((await UserModel.where({ name: "Ada" }).first())?.get("name")).toBe("Ada");

    connection.queue([{ id: 1, name: "Ada" }]);
    const found = await UserModel.firstOrCreate({ name: "Ada" }, { name: "Ada" });
    expect(found.get("name")).toBe("Ada");

    connection.queue([]);
    connection.queue([{ id: 12, name: "New" }]);
    const created = await UserModel.firstOrCreate({ name: "New" });
    expect(created.get("name")).toBe("New");

    connection.queue([]);
    const unsaved = await UserModel.firstOrNew({ name: "Ghost" });
    expect(unsaved.get("name")).toBe("Ghost");

    connection.queue([{ id: 1, name: "Ada" }]);
    connection.queue([{ id: 1, name: "Updated" }]);
    const updated = await UserModel.updateOrCreate({ name: "Ada" }, { name: "Updated" });
    expect(updated.get("name")).toBe("Updated");

    void ApplicationModel;
    void PositionModel;
  });

  test("relation exists clauses and remaining query helpers", async () => {
    const connection = new FakeConnection();
    const { UserModel, ApplicationModel } = createModels(connection);
    const user = new UserModel({ id: 1, name: "Ada" }, UserModel.repository());
    const application = new ApplicationModel(
      { id: 1, user_id: 1, position_id: 4, status_id: 1 },
      ApplicationModel.repository(),
    );

    expect(user.applications().toExistsClause("users").sql).toContain("applications");
    expect(user.position().toExistsClause("users").sql).toContain("positions");
    expect(user.tags().toExistsClause("users").sql).toContain("user_tag");
    expect(application.user().toExistsClause("applications").sql).toContain("users");
    expect(user.tags().hydrateEager({ tags: { id: 1 } }, "tags")).toEqual([]);

    connection.queue([]);
    expect(await user.applications().orderBy({ id: "ASC" }).limit(2).count()).toBe(0);

    class ImageModel extends Model<
      { id: number; imageable_type: string; imageable_id: number; url: string },
      "id"
    > {
      static override $timestamps = false;
      protected override primaryKey(): "id" {
        return "id";
      }
    }
    const imageTable = defineTable<
      { id: number; imageable_type: string; imageable_id: number; url: string },
      "id"
    >({
      name: "images",
      primaryKey: "id",
      columns: ["id", "imageable_type", "imageable_id", "url"],
    });
    class ImageRepository extends BaseRepository<
      { id: number; imageable_type: string; imageable_id: number; url: string },
      "id"
    > {
      constructor() {
        super(imageTable, connection);
      }
    }
    registerModelRepository(ImageModel, new ImageRepository());
    class PicturedUser extends UserModel {
      static override $morphClass = "users";
      images() {
        return this.morphMany(ImageModel, "imageable");
      }
      avatar() {
        return this.morphOne(ImageModel, "imageable");
      }
    }
    registerModelRepository(PicturedUser, UserModel.repository());
    const pictured = new PicturedUser({ id: 1, name: "Ada" }, PicturedUser.repository());
    expect(pictured.images().toExistsClause("users").sql).toContain("imageable_id");
    expect(pictured.avatar().toExistsClause("users").sql).toContain("imageable_type");

    connection.queue([]);
    await PicturedUser.has("avatar").get();
    expect(connection.calls.at(-1)?.query).toContain("EXISTS");
    connection.queue([]);
    await UserModel.has("tags").get();
    expect(connection.calls.at(-1)?.query).toContain("user_tag");
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
