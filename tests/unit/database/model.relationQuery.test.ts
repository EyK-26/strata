import { describe, expect, test } from "bun:test";
import { valueService } from "@getstrata/core/contracts/services";
import { createServiceToken } from "@getstrata/core/contracts/token";
import { BaseRepository } from "@getstrata/core/database/baseRepository";
import {
  type BoundModel,
  defineModel,
  defineRepository,
  type ModelDefinition,
  type ModelObserver,
} from "@getstrata/core/database/definitions";
import { Model } from "@getstrata/core/database/model";
import { defineTable } from "@getstrata/core/database/table";
import { withBoundDatabase } from "../../helpers/boundRepositoryHarness";

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

type ImageRow = { id: number; imageable_type: string; imageable_id: number; url: string };
class UserEntity extends Model<User, "id"> {
  applications() {
    return this.hasMany(ApplicationDefinition);
  }
  position() {
    return this.hasOne(PositionDefinition);
  }
  tags() {
    return this.belongsToMany(TagDefinition, "user_tag");
  }
}
class ApplicationEntity extends Model<Application, "id"> {
  user() {
    return this.belongsTo(UserDefinition);
  }
  position() {
    return this.belongsTo(PositionDefinition, "position_id");
  }
}
class PositionEntity extends Model<Position, "id"> {}
class TagEntity extends Model<Tag, "id"> {}
class VisibleUserEntity extends UserEntity {
  getInitialAttribute() {
    return "A";
  }
}
class ImageEntity extends Model<ImageRow, "id"> {}
class PicturedUserEntity extends UserEntity {
  images() {
    return this.morphMany(ImageDefinition, "imageable");
  }
  avatar() {
    return this.morphOne(ImageDefinition, "imageable");
  }
}
class ImageableEntity extends ImageEntity {
  imageable() {
    return this.morphTo({ users: PicturedDefinition }, "imageable");
  }
}
const users = defineRepository({
  name: "users",
  table: userTable,
  dependencies: [],
  create: (binding) => new BaseRepository(binding),
});
const positions = defineRepository({
  name: "positions",
  table: positionTable,
  dependencies: [],
  create: (binding) => new BaseRepository(binding),
});
const applications = defineRepository({
  name: "applications",
  table: applicationTable,
  dependencies: [],
  create: (binding) => new BaseRepository(binding),
});
const tags = defineRepository({
  name: "tags",
  table: tagTable,
  dependencies: [],
  create: (binding) => new BaseRepository(binding),
});
const imageTable = defineTable<ImageRow, "id">({
  name: "images",
  primaryKey: "id",
  columns: ["id", "imageable_type", "imageable_id", "url"],
});
const imageRepository = defineRepository({
  name: "images",
  table: imageTable,
  dependencies: [],
  create: (binding) => new BaseRepository(binding),
});
const UserObserver = createServiceToken<ModelObserver<UserEntity>>("user-observer");
const UserDefinition: ModelDefinition<User, "id", UserEntity> = defineModel({
  name: "UserModel",
  repository: users,
  dependencies: [],
  attributes: { fillable: ["name"], timestamps: false },
  observers: [UserObserver],
  construct: (state, binding) => new UserEntity(state, binding),
});
const ApplicationDefinition: ModelDefinition<Application, "id", ApplicationEntity> = defineModel({
  name: "ApplicationModel",
  repository: applications,
  dependencies: [],
  attributes: { fillable: ["user_id", "position_id", "status_id"], timestamps: false },
  construct: (state, binding) => new ApplicationEntity(state, binding),
});
const PositionDefinition = defineModel({
  name: "PositionModel",
  repository: positions,
  dependencies: [],
  attributes: { fillable: ["user_id", "name"], timestamps: false },
  construct: (state, binding) => new PositionEntity(state, binding),
});
const TagDefinition = defineModel({
  name: "TagModel",
  repository: tags,
  dependencies: [],
  attributes: { fillable: ["name"], timestamps: false },
  construct: (state, binding) => new TagEntity(state, binding),
});
const VisibleDefinition = defineModel({
  name: "VisibleUser",
  repository: users,
  dependencies: [],
  attributes: { fillable: ["name"], timestamps: false, hidden: ["name"] },
  construct: (state, binding) => new VisibleUserEntity(state, binding),
});
const ImageDefinition: ModelDefinition<ImageRow, "id", ImageEntity> = defineModel({
  name: "ImageModel",
  repository: imageRepository,
  dependencies: [],
  attributes: { fillable: ["imageable_type", "imageable_id", "url"], timestamps: false },
  construct: (state, binding) => new ImageEntity(state, binding),
});
const PicturedDefinition: ModelDefinition<User, "id", PicturedUserEntity> = defineModel({
  name: "users",
  aliases: ["PicturedUser"],
  repository: users,
  dependencies: [],
  attributes: { fillable: ["name"], timestamps: false },
  construct: (state, binding) => new PicturedUserEntity(state, binding),
});
const ImageableDefinition: ModelDefinition<ImageRow, "id", ImageableEntity> = defineModel({
  name: "ImageableModel",
  repository: imageRepository,
  dependencies: [],
  attributes: { fillable: ["imageable_type", "imageable_id", "url"], timestamps: false },
  construct: (state, binding) => new ImageableEntity(state, binding),
});
type Graph = {
  UserModel: BoundModel<User, "id", UserEntity>;
  ApplicationModel: BoundModel<Application, "id", ApplicationEntity>;
  PositionModel: BoundModel<Position, "id", PositionEntity>;
  TagModel: BoundModel<Tag, "id", TagEntity>;
  VisibleUser: BoundModel<User, "id", VisibleUserEntity>;
  ImageModel: BoundModel<ImageRow, "id", ImageEntity>;
  PicturedUser: BoundModel<User, "id", PicturedUserEntity>;
  ImageableModel: BoundModel<ImageRow, "id", ImageableEntity>;
};
async function withModels(
  connection: FakeConnection,
  work: (graph: Graph) => Promise<void>,
  observer: ModelObserver<UserEntity> = {},
) {
  await withBoundDatabase(
    {
      definition: {
        default: "main",
        connections: { main: { driver: "sqlite", filename: ":memory:" } },
        repositories: [users, positions, applications, tags, imageRepository],
        models: [
          UserDefinition,
          ApplicationDefinition,
          PositionDefinition,
          TagDefinition,
          VisibleDefinition,
          ImageDefinition,
          PicturedDefinition,
          ImageableDefinition,
        ],
      },
      connection,
      services: [valueService(UserObserver, observer)],
    },
    async (db) =>
      work({
        UserModel: db.model(UserDefinition),
        ApplicationModel: db.model(ApplicationDefinition),
        PositionModel: db.model(PositionDefinition),
        TagModel: db.model(TagDefinition),
        VisibleUser: db.model(VisibleDefinition),
        ImageModel: db.model(ImageDefinition),
        PicturedUser: db.model(PicturedDefinition),
        ImageableModel: db.model(ImageableDefinition),
      }),
  );
}

describe("Eloquent-style model relations", () => {
  test("hasMany get/where/count/create/createMany use the inferred foreign key", async () => {
    const connection = new FakeConnection();
    await withModels(
      connection,
      async ({ UserModel }) => {
        const user = UserModel.hydrate({ id: 7, name: "Ada" });

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
        expect(created).toBeInstanceOf(ApplicationEntity);

        connection.queue([{ id: 4, user_id: 7, position_id: 1, status_id: 1 }]);
        connection.queue([{ id: 5, user_id: 7, position_id: 2, status_id: 1 }]);
        const many = await user.applications().createMany([
          { position_id: 1, status_id: 1 },
          { position_id: 2, status_id: 1 },
        ]);
        expect(many).toHaveLength(2);
      },
      {},
    );
  });

  test("hasMany first() returns one related model", async () => {
    const connection = new FakeConnection();
    await withModels(
      connection,
      async ({ UserModel }) => {
        const user = UserModel.hydrate({ id: 1, name: "Ada" });

        connection.queue([{ id: 10, user_id: 1, position_id: 4, status_id: 1 }]);
        const first = await user.applications().first();
        expect(first?.id).toBe(10);

        connection.queue([]);
        expect(await user.applications().first()).toBeNull();
      },
      {},
    );
  });

  test("hasOne get/create and load/loaded", async () => {
    const connection = new FakeConnection();
    await withModels(
      connection,
      async ({ UserModel }) => {
        const user = UserModel.hydrate({ id: 3, name: "Recruiter" });

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
        expect(created).toBeInstanceOf(PositionEntity);
        expect(created.get("user_id")).toBe(3);

        connection.queue([{ id: 8, user_id: 3, name: "Engineer" }]);
        await user.load("position");
        expect(user.loaded<{ get: (key: "name") => string }>("position")?.get("name")).toBe(
          "Engineer",
        );

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
      },
      {},
    );
  });

  test("belongsTo get/associate/dissociate", async () => {
    const connection = new FakeConnection();
    await withModels(
      connection,
      async ({ UserModel, ApplicationModel }) => {
        const application = ApplicationModel.hydrate({
          id: 11,
          user_id: 7,
          position_id: 4,
          status_id: 1,
        });

        connection.queue([{ id: 7, name: "Ada" }]);
        const owner = await application.user().get();
        expect(owner?.get("name")).toBe("Ada");
        connection.queue([{ id: 7, name: "Ada" }]);
        expect(await application.user().first()).not.toBeNull();

        const orphan = ApplicationModel.hydrate({
          id: 12,
          user_id: null as unknown as number,
          position_id: 4,
          status_id: 1,
        });
        expect(await orphan.user().get()).toBeNull();

        connection.queue([{ id: 11 }]);
        await application.user().associate({ id: 2 });
        expect(connection.calls.at(-1)?.query).toContain("UPDATE");
        expect(connection.calls.at(-1)?.params).toContain(2);

        connection.queue([{ id: 11 }]);
        const ada = UserModel.hydrate({ id: 7, name: "Ada" });
        await application.user().associate(ada);
        expect(connection.calls.at(-1)?.params).toContain(7);

        connection.queue([{ id: 11 }]);
        await application.user().dissociate();
        expect(connection.calls.at(-1)?.params).toContain(null);

        await expect(application.user().associate({} as { id?: unknown })).rejects.toThrow(
          "belongsTo.associate() requires a related model or { id }.",
        );
      },
      {},
    );
  });

  test("belongsToMany get/attach/detach/sync/create", async () => {
    const connection = new FakeConnection();
    await withModels(
      connection,
      async ({ UserModel }) => {
        const user = UserModel.hydrate({ id: 1, name: "Ada" });

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
          { id: 20, name: "strata" },
        ]);
        const tags = await user.tags().where({}).orderBy({ name: "ASC" }).get();
        expect(tags.map((tag) => tag.get("name"))).toEqual(["bun", "strata"]);

        await user.tags().attach(30);
        expect(connection.calls.at(-1)?.query).toContain("INSERT");
        await user.tags().attach([31, 32]);
        expect(connection.calls.at(-1)?.query).toContain("VALUES ($1, $2), ($3, $4)");
        expect(connection.calls.at(-1)?.params).toEqual([1, 31, 1, 32]);
        connection.queue([{ tag_id: 31 }]);
        await user.tags().toggle([31, 32]);
        expect(connection.calls.at(-2)?.query).toContain("DELETE");
        expect(connection.calls.at(-1)?.query).toContain("INSERT");
        expect(connection.calls.at(-1)?.params).toEqual([1, 32]);

        await user.tags().detach();
        expect(connection.calls.at(-1)?.query).toContain("DELETE");
        await user.tags().detach(30);
        expect(connection.calls.at(-1)?.query).toContain("IN ($2)");
        await user.tags().detach([31]);

        await user.tags().sync([]);
        await user.tags().sync([10]);
        expect(connection.calls.at(-1)?.query).toContain("INSERT");

        connection.queue([{ id: 40, name: "htmx" }]);
        const created = await user.tags().create({ name: "htmx" });
        expect(created).toBeInstanceOf(TagEntity);
        expect(connection.calls.at(-1)?.query).toMatch(/INSERT INTO ["`]?user_tag["`]?/);
      },
      {},
    );
  });

  test("load and Model.with eager-load relation methods", async () => {
    const connection = new FakeConnection();
    await withModels(
      connection,
      async ({ UserModel, ApplicationModel }) => {
        const user = UserModel.hydrate({ id: 1, name: "Ada" });

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
        const withUser = await ApplicationModel.with("user").first();
        expect(
          withUser?.loaded<{ name?: string }>("user") ?? withUser?.loaded("user"),
        ).toBeDefined();

        expect(() => UserModel.with("nope")).toThrow("has no relation method nope()");

        const tagsRelation = user.tags();
        tagsRelation.applyEagerLoad(UserModel.query().query as never, "tags");
        expect(tagsRelation.hydrateEager({}, "tags")).toEqual([]);
        expect(user.applications().hydrateEager({}, "applications")).toEqual([]);
      },
      {},
    );
  });

  test("toArray, observers, whereHas, morph, and nested load", async () => {
    const connection = new FakeConnection();
    const hooks: string[] = [];
    await withModels(
      connection,
      async ({
        UserModel,
        ApplicationModel,
        PositionModel,
        VisibleUser,
        PicturedUser,
        ImageableModel,
      }) => {
        const user = VisibleUser.hydrate({ id: 1, name: "Ada" });
        expect(user.toArray()).toEqual({ id: 1 });
        user.append("initial").makeVisible("name");
        expect(user.toJSON().initial).toBe("A");
        user.makeHidden("id");
        expect(user.toArray().id).toBeUndefined();

        connection.queue([{ id: 9, name: "New" }]);
        await UserModel.create({ name: "New" });
        expect(hooks).toEqual(["creating", "created"]);
        const doomed = UserModel.hydrate({ id: 1, name: "Ada" });
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

        const pictured = PicturedUser.hydrate({ id: 4, name: "Ada" });
        connection.queue([{ id: 1, imageable_type: "users", imageable_id: 4, url: "/a.png" }]);
        const images = await pictured.images().get();
        expect(images[0]?.get("url")).toBe("/a.png");
        connection.queue([{ id: 2, imageable_type: "users", imageable_id: 4, url: "/b.png" }]);
        expect((await pictured.avatar().create({ url: "/b.png" })).get("url")).toBe("/b.png");

        connection.queue([{ id: 1, user_id: 1, position_id: 4, status_id: 1 }]);
        connection.queue([{ id: 4, user_id: 1, name: "Engineer" }]);
        await user.load("applications.position");
        expect(user.loaded<unknown[]>("applications")).toHaveLength(1);

        const image = ImageableModel.hydrate({
          id: 3,
          imageable_type: "users",
          imageable_id: 4,
          url: "/c.png",
        });
        connection.queue([{ id: 4, name: "Ada" }]);
        expect((await image.imageable().get())?.get("name")).toBe("Ada");

        const missingType = ImageableModel.hydrate({
          id: 4,
          imageable_type: "unknown",
          imageable_id: 4,
          url: "/d.png",
        });
        expect(await missingType.imageable().get()).toBeNull();
        expect(missingType.imageable().toExistsClause("images").sql).toContain("1 = 0");

        const missingId = ImageableModel.hydrate({
          id: 5,
          imageable_type: "users",
          imageable_id: null as unknown as number,
          url: "/e.png",
        });
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

        pictured.images().applyEagerLoad(PicturedUser.query().query as never, "images");
        pictured
          .avatar()
          .where({ url: "/a.png" })
          .applyEagerLoad(PicturedUser.query().query as never, "avatar");
        image.imageable().applyEagerLoad(ImageableModel.query().query as never, "imageable");
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
      },
      {
        creating: () => {
          hooks.push("creating");
        },
        created: () => {
          hooks.push("created");
        },
        deleting: () => false,
      },
    );
  });

  test("relation exists clauses and remaining query helpers", async () => {
    const connection = new FakeConnection();
    await withModels(
      connection,
      async ({ UserModel, ApplicationModel, PicturedUser }) => {
        const user = UserModel.hydrate({ id: 1, name: "Ada" });
        const application = ApplicationModel.hydrate({
          id: 1,
          user_id: 1,
          position_id: 4,
          status_id: 1,
        });

        expect(user.applications().toExistsClause("users").sql).toContain("applications");
        expect(user.position().toExistsClause("users").sql).toContain("positions");
        expect(user.tags().toExistsClause("users").sql).toContain("user_tag");
        expect(application.user().toExistsClause("applications").sql).toContain("users");
        expect(user.tags().hydrateEager({ tags: { id: 1 } }, "tags")).toEqual([]);

        connection.queue([]);
        expect(await user.applications().orderBy({ id: "ASC" }).limit(2).count()).toBe(0);

        const pictured = PicturedUser.hydrate({ id: 1, name: "Ada" });
        expect(pictured.images().toExistsClause("users").sql).toContain("imageable_id");
        expect(pictured.avatar().toExistsClause("users").sql).toContain("imageable_type");

        connection.queue([]);
        await PicturedUser.has("avatar").get();
        expect(connection.calls.at(-1)?.query).toContain("EXISTS");
        connection.queue([]);
        await UserModel.has("tags").get();
        expect(connection.calls.at(-1)?.query).toContain("user_tag");
      },
      {},
    );
  });

  test("belongsTo orderBy is applied when present", async () => {
    const connection = new FakeConnection();
    await withModels(
      connection,
      async ({ ApplicationModel }) => {
        const application = ApplicationModel.hydrate({
          id: 1,
          user_id: 7,
          position_id: 4,
          status_id: 1,
        });

        connection.queue([{ id: 7, name: "Ada" }]);
        await application.user().orderBy({ name: "DESC" }).get();
        expect(connection.calls[0]?.query.toLowerCase()).toContain("order");
      },
      {},
    );
  });
});

describe("immutable-alias shop-shaped eager loads", () => {
  interface ShopCategory {
    id: number;
    name: string;
    tenant_id: number;
  }

  interface ShopProduct {
    id: number;
    name: string;
    category_id: number;
    tenant_id: number;
  }

  interface ShopCartItem {
    id: number;
    product_id: number;
    tenant_id: number;
  }

  const categoryTable = defineTable<ShopCategory, "id">({
    name: "categories",
    primaryKey: "id",
    columns: ["id", "name", "tenant_id"],
  });

  const productTable = defineTable<ShopProduct, "id">({
    name: "products",
    primaryKey: "id",
    columns: ["id", "name", "category_id", "tenant_id"],
  });

  const cartItemTable = defineTable<ShopCartItem, "id">({
    name: "cart_items",
    primaryKey: "id",
    columns: ["id", "product_id", "tenant_id"],
  });

  class CategoryEntity extends Model<ShopCategory, "id"> {
    products() {
      return this.hasMany("Product");
    }
  }
  class ProductEntity extends Model<ShopProduct, "id"> {
    category() {
      return this.belongsTo("Category");
    }
  }
  class CartItemEntity extends Model<ShopCartItem, "id"> {
    product() {
      return this.belongsTo("Product");
    }
  }
  const categories = defineRepository({
    name: "categories",
    table: categoryTable,
    dependencies: [],
    create: (binding) => new BaseRepository(binding),
  });
  const products = defineRepository({
    name: "products",
    table: productTable,
    dependencies: [],
    create: (binding) => new BaseRepository(binding),
  });
  const cartItems = defineRepository({
    name: "cartItems",
    table: cartItemTable,
    dependencies: [],
    create: (binding) => new BaseRepository(binding),
  });
  const Category = defineModel({
    name: "ShopCategoryModel",
    aliases: ["Category"],
    repository: categories,
    dependencies: [],
    attributes: { fillable: ["name", "tenant_id"], timestamps: false },
    construct: (state, binding) => new CategoryEntity(state, binding),
  });
  const Product = defineModel({
    name: "ShopProductModel",
    aliases: ["Product"],
    repository: products,
    dependencies: [],
    attributes: { fillable: ["name", "category_id", "tenant_id"], timestamps: false },
    construct: (state, binding) => new ProductEntity(state, binding),
  });
  const CartItem = defineModel({
    name: "ShopCartItemModel",
    aliases: ["CartItem"],
    repository: cartItems,
    dependencies: [],
    attributes: { fillable: ["product_id", "tenant_id"], timestamps: false },
    construct: (state, binding) => new CartItemEntity(state, binding),
  });
  const shopConfig = {
    default: "main",
    connections: { main: { driver: "sqlite" as const, filename: ":memory:" } },
    repositories: [categories, products, cartItems],
    models: [Category, Product, CartItem],
  };
  async function withShop(
    connection: FakeConnection,
    work: (graph: {
      ShopCategoryModel: BoundModel<ShopCategory, "id", CategoryEntity>;
      ShopProductModel: BoundModel<ShopProduct, "id", ProductEntity>;
      ShopCartItemModel: BoundModel<ShopCartItem, "id", CartItemEntity>;
    }) => Promise<void>,
    foreignConnection?: FakeConnection,
  ) {
    const run = () =>
      withBoundDatabase({ definition: shopConfig, connection }, async (db) =>
        work({
          ShopCategoryModel: db.model(Category),
          ShopProductModel: db.model(Product),
          ShopCartItemModel: db.model(CartItem),
        }),
      );
    if (foreignConnection)
      await withBoundDatabase(
        { definition: shopConfig, connection: foreignConnection },
        async (foreign) => {
          foreign.model(Category);
          await run();
        },
      );
    else await run();
  }

  test("with(category) and with(product) hydrate string-registered belongsTo/hasMany", async () => {
    const connection = new FakeConnection();
    await withShop(
      connection,
      async ({ ShopCategoryModel, ShopProductModel, ShopCartItemModel }) => {
        connection.queue([{ id: 2, name: "Mug", category_id: 9, tenant_id: 1 }]);
        connection.queue([{ id: 9, name: "Drinkware", tenant_id: 1 }]);
        const products = await ShopProductModel.with("category").get();
        expect(products).toHaveLength(1);
        expect(
          products[0]?.loaded<{ get: (key: string) => unknown }>("category")?.get("name"),
        ).toBe("Drinkware");

        connection.queue([{ id: 4, product_id: 2, tenant_id: 1 }]);
        connection.queue([{ id: 2, name: "Mug", category_id: 9, tenant_id: 1 }]);
        const lines = await ShopCartItemModel.with("product").get();
        expect(lines[0]?.loaded<{ get: (key: string) => unknown }>("product")?.get("name")).toBe(
          "Mug",
        );

        connection.queue([{ id: 9, name: "Drinkware", tenant_id: 1 }]);
        connection.queue([{ id: 2, name: "Mug", category_id: 9, tenant_id: 1 }]);
        const categories = await ShopCategoryModel.with("products").get();
        expect(categories[0]?.loaded<unknown[]>("products")).toHaveLength(1);
      },
    );
  });

  test("with() accepts Laravel-style relation name arrays", async () => {
    const connection = new FakeConnection();
    await withShop(connection, async ({ ShopProductModel, ShopCartItemModel }) => {
      connection.queue([{ id: 2, name: "Mug", category_id: 9, tenant_id: 1 }]);
      connection.queue([{ id: 9, name: "Drinkware", tenant_id: 1 }]);
      const products = await ShopProductModel.with(["category"]).get();
      expect(products[0]?.loaded<{ get: (key: string) => unknown }>("category")?.get("name")).toBe(
        "Drinkware",
      );

      const line = ShopCartItemModel.hydrate({ id: 4, product_id: 2, tenant_id: 1 });
      connection.queue([{ id: 2, name: "Mug", category_id: 9, tenant_id: 1 }]);
      await line.load(["product"]);
      expect(line.loaded<{ get: (key: string) => unknown }>("product")?.get("name")).toBe("Mug");
    });
  });

  test("belongsTo eager load uses the exact parent registry after a foreign app warms the same definition", async () => {
    const parentConnection = new FakeConnection();
    const relatedConnection = new FakeConnection();
    await withShop(
      parentConnection,
      async ({ ShopProductModel }) => {
        parentConnection.queue([{ id: 2, name: "Mug", category_id: 9, tenant_id: 1 }]);
        parentConnection.queue([{ id: 9, name: "Drinkware", tenant_id: 1 }]);
        const products = await ShopProductModel.with("category").get();

        expect(
          products[0]?.loaded<{ get: (key: string) => unknown }>("category")?.get("name"),
        ).toBe("Drinkware");
        expect(relatedConnection.calls).toHaveLength(0);
        expect(parentConnection.calls.length).toBeGreaterThan(1);
      },
      relatedConnection,
    );
  });

  test("with() looks up the relation method name, not the model class name", async () => {
    const connection = new FakeConnection();
    await withShop(connection, async ({ ShopProductModel }) => {
      expect(() => ShopProductModel.with("Category")).toThrow("has no relation method Category()");
    });
  });
});
