import { describe, expect, test } from "bun:test";
import { BaseRepository } from "@getstrata/core/database/baseRepository";
import {
  type BoundModel,
  defineModel,
  defineRepository,
  type ModelDefinition,
} from "@getstrata/core/database/definitions";
import { defineFactory, Factory } from "@getstrata/core/database/factory";
import { Model } from "@getstrata/core/database/model";
import { defineTable } from "@getstrata/core/database/table";
import { JsonResource } from "@getstrata/core/http/resources";
import { withBoundDatabase } from "../../helpers/boundRepositoryHarness";

interface User {
  id: number;
  name: string;
  role_id: number | string;
}

interface Position {
  id: number;
  name: string;
  hiring: boolean;
  user_id: number | null;
}

interface Application {
  id: number;
  user_id: number;
  position_id: number;
}

interface Notification {
  id: number;
  type: string;
  notifiable_type: string;
  notifiable_id: number;
  data: string;
}

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

const userTable = defineTable<User, "id">({
  name: "users",
  primaryKey: "id",
  columns: ["id", "name", "role_id"],
});
const positionTable = defineTable<Position, "id">({
  name: "positions",
  primaryKey: "id",
  columns: ["id", "name", "hiring", "user_id"],
});
const applicationTable = defineTable<Application, "id">({
  name: "applications",
  primaryKey: "id",
  columns: ["id", "user_id", "position_id"],
});
const notificationTable = defineTable<Notification, "id">({
  name: "notifications",
  primaryKey: "id",
  columns: ["id", "type", "notifiable_type", "notifiable_id", "data"],
});

class UserEntity extends Model<User, "id"> {
  applications() {
    return this.hasMany(ApplicationDefinition);
  }
  position() {
    return this.hasOne(PositionDefinition);
  }
  notifications() {
    return this.morphMany(NotificationDefinition, "notifiable");
  }
}
class ApplicationEntity extends Model<Application, "id"> {
  user() {
    return this.belongsTo(() => UserDefinition);
  }
  position() {
    return this.belongsTo("PositionModel", "position_id");
  }
}
class PositionEntity extends Model<Position, "id"> {
  applications() {
    return this.hasMany(ApplicationDefinition);
  }
}
class NotificationEntity extends Model<Notification, "id"> {
  notifiable() {
    return this.morphTo({ "App\\Models\\User": UserDefinition }, "notifiable");
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
const notifications = defineRepository({
  name: "notifications",
  table: notificationTable,
  dependencies: [],
  create: (binding) => new BaseRepository(binding),
});
const UserDefinition: ModelDefinition<User, "id", UserEntity> = defineModel({
  name: "App\\Models\\User",
  aliases: ["UserModel"],
  repository: users,
  dependencies: [],
  attributes: { timestamps: false, casts: { role_id: "integer" }, fillable: ["name", "role_id"] },
  construct: (state, binding) => new UserEntity(state, binding),
});
const PositionDefinition: ModelDefinition<Position, "id", PositionEntity> = defineModel({
  name: "PositionModel",
  repository: positions,
  dependencies: [],
  attributes: { timestamps: false, fillable: ["name", "hiring", "user_id"] },
  construct: (state, binding) => new PositionEntity(state, binding),
});
const ApplicationDefinition: ModelDefinition<Application, "id", ApplicationEntity> = defineModel({
  name: "ApplicationModel",
  repository: applications,
  dependencies: [],
  attributes: { timestamps: false, fillable: ["user_id", "position_id"] },
  construct: (state, binding) => new ApplicationEntity(state, binding),
});
const NotificationDefinition: ModelDefinition<Notification, "id", NotificationEntity> = defineModel(
  {
    name: "NotificationModel",
    repository: notifications,
    dependencies: [],
    attributes: {
      timestamps: false,
      fillable: ["type", "notifiable_type", "notifiable_id", "data"],
    },
    construct: (state, binding) => new NotificationEntity(state, binding),
  },
);

async function withGraph(
  connection: FakeConnection,
  work: (graph: {
    UserModel: BoundModel<User, "id", UserEntity>;
    ApplicationModel: BoundModel<Application, "id", ApplicationEntity>;
    PositionModel: BoundModel<Position, "id", PositionEntity>;
    NotificationModel: BoundModel<Notification, "id", NotificationEntity>;
    ApplicationFactory: () => Factory<Application>;
  }) => Promise<void>,
) {
  await withBoundDatabase(
    {
      definition: {
        default: "main",
        connections: { main: { driver: "sqlite", filename: ":memory:" } },
        repositories: [users, positions, applications, notifications],
        models: [UserDefinition, PositionDefinition, ApplicationDefinition, NotificationDefinition],
      },
      connection,
    },
    async (db) => {
      const model = db.model(ApplicationDefinition);
      const definition = defineFactory<Application>({
        construct: () => ({
          definition: () => ({ id: 0, user_id: 0, position_id: 0 }),
          persist: async (values) => (await model.create(values)).toObject(),
        }),
      });
      const ApplicationFactory = () => Factory.from(definition);
      await work({
        UserModel: db.model(UserDefinition),
        PositionModel: db.model(PositionDefinition),
        ApplicationModel: db.model(ApplicationDefinition),
        NotificationModel: db.model(NotificationDefinition),
        ApplicationFactory,
      });
    },
  );
}

describe("HiroApp-shaped Eloquent parity", () => {
  test("relation queries are thenable and delegate to get()", async () => {
    const connection = new FakeConnection();
    await withGraph(connection, async ({ UserModel }) => {
      const user = UserModel.hydrate({ id: 7, name: "Ada", role_id: "2" });

      connection.queue([{ id: 1, user_id: 7, position_id: 4 }]);
      const apps = await user.applications();
      expect(Array.isArray(apps)).toBe(true);
      expect(apps[0]?.get("user_id")).toBe(7);

      connection.queue([{ id: 8, name: "Engineer", hiring: true, user_id: 7 }]);
      const position = await user.position();
      expect(position?.get("name")).toBe("Engineer");
    });
  });

  test("with() is a query: where/findOrFail/LIMIT first()", async () => {
    const connection = new FakeConnection();
    await withGraph(connection, async ({ PositionModel, ApplicationModel }) => {
      connection.queue([{ id: 4, name: "Engineer", hiring: true, user_id: 7 }]);
      connection.queue([{ id: 1, user_id: 7, position_id: 4 }]);
      const open = await PositionModel.with("applications").where({ hiring: true }).get();
      expect(open).toHaveLength(1);
      expect(open[0]?.loaded<unknown[]>("applications")).toHaveLength(1);
      expect(connection.calls[0]?.query.toLowerCase()).toContain("hiring");

      connection.queue([{ id: 1, user_id: 7, position_id: 4 }]);
      connection.queue([{ id: 7, name: "Ada", role_id: 2 }]);
      connection.queue([{ id: 4, name: "Engineer", hiring: true, user_id: 7 }]);
      const one = await ApplicationModel.with("user", "position").findOrFail(1);
      expect(one.get("id")).toBe(1);
      expect(connection.calls.some((call) => call.query.toLowerCase().includes("limit"))).toBe(
        true,
      );
    });
  });

  test("with() and nested load match int4 PKs to int8 FKs", async () => {
    const connection = new FakeConnection();
    await withGraph(connection, async ({ ApplicationModel, UserModel }) => {
      connection.queue([{ id: 1, user_id: 7n, position_id: 4n }]);
      connection.queue([{ id: 4, name: "Office", hiring: true, user_id: 7 }]);
      const apps = await ApplicationModel.with("position").get();
      expect(apps[0]?.loaded<{ get: (key: string) => unknown }>("position")?.get("name")).toBe(
        "Office",
      );

      connection.queue([{ id: 7, name: "Ada", role_id: 2 }]);
      connection.queue([{ id: 1, user_id: 7n, position_id: 4n }]);
      connection.queue([{ id: 4, name: "Office", hiring: true, user_id: 7 }]);
      const users = await UserModel.with("applications.position").get();
      const nestedApps =
        users[0]?.loaded<
          Array<{ loaded: (name: string) => { get: (key: string) => unknown } | undefined }>
        >("applications");
      expect(nestedApps).toHaveLength(1);
      expect(nestedApps?.[0]?.loaded("position")?.get("name")).toBe("Office");
    });
  });

  test("belongsTo whereHas threads extra constraints into EXISTS", async () => {
    const connection = new FakeConnection();
    await withGraph(connection, async ({ ApplicationModel }) => {
      connection.queue([]);
      await ApplicationModel.whereHas("position", (query) => {
        query.where?.({ name: { ilike: "%Engineer%" } });
      })
        .where({ user_id: 9 })
        .get();

      const sql = connection.calls.at(-1)?.query ?? "";
      const params = connection.calls.at(-1)?.params ?? [];
      expect(sql).toContain("EXISTS");
      expect(sql).toContain("positions");
      expect(sql).toContain("ILIKE");
      expect(params).toContain("%Engineer%");
      expect(params).toContain(9);
    });
  });

  test("morphMany writes class names and morphTo uses an explicit morph name", async () => {
    const connection = new FakeConnection();
    await withGraph(connection, async ({ UserModel, NotificationModel }) => {
      const user = UserModel.hydrate({ id: 3, name: "Ada", role_id: 2 });

      connection.queue([
        {
          id: 1,
          type: "App\\Notifications\\X",
          notifiable_type: "App\\Models\\User",
          notifiable_id: 3,
          data: "{}",
        },
      ]);
      const created = await user
        .notifications()
        .create({ type: "App\\Notifications\\X", data: "{}" });
      expect(created.get("notifiable_type")).toBe("App\\Models\\User");

      connection.queue([{ count: 1 }]);
      expect(await user.notifications().count()).toBe(1);
      expect(connection.calls.at(-1)?.query).toContain("COUNT(*)");

      const notification = NotificationModel.hydrate({
        id: 1,
        type: "App\\Notifications\\X",
        notifiable_type: "App\\Models\\User",
        notifiable_id: 3,
        data: "{}",
      });
      expect(notification.notifiable().toExistsClause("notifications").sql).toContain(
        "notifiable_id",
      );
    });
  });

  test("integer casts, factory for() without FK, and collection wrap-once", async () => {
    const connection = new FakeConnection();
    await withGraph(connection, async ({ UserModel, ApplicationFactory }) => {
      const user = UserModel.hydrate({ id: 7, name: "Ada", role_id: "2" });
      expect(user.get("role_id")).toBe(2);

      connection.queue([{ id: 11, user_id: 7, position_id: 4 }]);
      const created = await ApplicationFactory().for(user).for({ id: 4 }, "position_id").create();
      expect(created.user_id).toBe(7);
      expect(created.position_id).toBe(4);

      expect(JsonResource.collection([{ a: 1 }]).toResponse()).toEqual({ data: [{ a: 1 }] });
    });
  });

  test("immutable definitions prepare relationship aliases without mutable registration", async () => {
    const connection = new FakeConnection();
    await withGraph(connection, async ({ ApplicationModel }) => {
      connection.queue([{ id: 4, name: "Office", hiring: true, user_id: 7 }]);
      const application = ApplicationModel.hydrate({ id: 1, user_id: 7, position_id: 4 });
      const position = await application.position();
      expect(position?.get("name")).toBe("Office");
    });
  });

  test("primaryKey defaults to id without an override", async () => {
    const connection = new FakeConnection();
    await withGraph(connection, async ({ UserModel }) => {
      expect(UserModel.hydrate({ id: 1, name: "X", role_id: 1 }).id).toBe(1);
    });
  });
});
