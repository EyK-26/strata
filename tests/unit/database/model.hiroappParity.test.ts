import { describe, expect, test } from "bun:test";
import { BaseRepository } from "@getstrata/core/database/baseRepository";
import { Factory } from "@getstrata/core/database/factory";
import { Model, registerModelClass, registerModelRepository } from "@getstrata/core/database/model";
import { defineTable } from "@getstrata/core/database/table";
import { JsonResource } from "@getstrata/core/http/resources";

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

function createGraph(connection: FakeConnection) {
  class UserModel extends Model<User, "id"> {
    static override $timestamps = false;
    static override $morphClass = "App\\Models\\User";
    static override $casts = { role_id: "integer" as const };
    static override $fillable = ["name", "role_id"] as const;

    applications() {
      return this.hasMany(ApplicationModel);
    }

    position() {
      return this.hasOne(PositionModel);
    }

    notifications() {
      return this.morphMany(NotificationModel, "notifiable");
    }
  }

  class ApplicationModel extends Model<Application, "id"> {
    static override $timestamps = false;
    static override $fillable = ["user_id", "position_id"] as const;

    user() {
      return this.belongsTo(() => UserModel);
    }

    position() {
      return this.belongsTo("PositionModel", "position_id");
    }
  }

  class PositionModel extends Model<Position, "id"> {
    static override $timestamps = false;
    static override $fillable = ["name", "hiring", "user_id"] as const;

    applications() {
      return this.hasMany(ApplicationModel);
    }
  }

  class NotificationModel extends Model<Notification, "id"> {
    static override $timestamps = false;
    static override $fillable = ["type", "notifiable_type", "notifiable_id", "data"] as const;

    notifiable() {
      return this.morphTo({ "App\\Models\\User": UserModel }, "notifiable");
    }
  }

  class ApplicationFactory extends Factory<Application> {
    protected override model = ApplicationModel;
    protected override definition(): Application {
      return { id: 0, user_id: 0, position_id: 0 };
    }
  }

  registerModelRepository(
    UserModel,
    new (class extends BaseRepository<User, "id"> {
      constructor() {
        super(userTable, connection);
      }
    })(),
  );
  registerModelRepository(
    PositionModel,
    new (class extends BaseRepository<Position, "id"> {
      constructor() {
        super(positionTable, connection);
      }
    })(),
  );
  registerModelRepository(
    ApplicationModel,
    new (class extends BaseRepository<Application, "id"> {
      constructor() {
        super(applicationTable, connection);
      }
    })(),
  );
  registerModelRepository(
    NotificationModel,
    new (class extends BaseRepository<Notification, "id"> {
      constructor() {
        super(notificationTable, connection);
      }
    })(),
  );
  registerModelClass("PositionModel", PositionModel);

  return { UserModel, ApplicationModel, PositionModel, NotificationModel, ApplicationFactory };
}

describe("HiroApp-shaped Eloquent parity", () => {
  test("relation queries are thenable and delegate to get()", async () => {
    const connection = new FakeConnection();
    const { UserModel } = createGraph(connection);
    const user = new UserModel({ id: 7, name: "Ada", role_id: "2" }, UserModel.repository());

    connection.queue([{ id: 1, user_id: 7, position_id: 4 }]);
    const apps = await user.applications();
    expect(Array.isArray(apps)).toBe(true);
    expect(apps[0]?.get("user_id")).toBe(7);

    connection.queue([{ id: 8, name: "Engineer", hiring: true, user_id: 7 }]);
    const position = await user.position();
    expect(position?.get("name")).toBe("Engineer");
  });

  test("with() is a query: where/findOrFail/LIMIT first()", async () => {
    const connection = new FakeConnection();
    const { PositionModel, ApplicationModel } = createGraph(connection);

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
    expect(connection.calls.some((call) => call.query.toLowerCase().includes("limit"))).toBe(true);
  });

  test("belongsTo whereHas threads extra constraints into EXISTS", async () => {
    const connection = new FakeConnection();
    const { ApplicationModel } = createGraph(connection);

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

  test("morphMany writes Laravel class names and morphTo uses explicit morph name", async () => {
    const connection = new FakeConnection();
    const { UserModel, NotificationModel } = createGraph(connection);
    const user = new UserModel({ id: 3, name: "Ada", role_id: 2 }, UserModel.repository());

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

    const notification = new NotificationModel(
      {
        id: 1,
        type: "App\\Notifications\\X",
        notifiable_type: "App\\Models\\User",
        notifiable_id: 3,
        data: "{}",
      },
      NotificationModel.repository(),
    );
    expect(notification.notifiable().toExistsClause("notifications").sql).toContain(
      "notifiable_id",
    );
  });

  test("integer casts, factory for() without FK, and collection wrap-once", async () => {
    const connection = new FakeConnection();
    const { UserModel, ApplicationFactory } = createGraph(connection);
    const user = new UserModel({ id: 7, name: "Ada", role_id: "2" }, UserModel.repository());
    expect(user.get("role_id")).toBe(2);

    connection.queue([{ id: 11, user_id: 7, position_id: 4 }]);
    const created = await new ApplicationFactory().for(user).for({ id: 4 }, "position_id").create();
    expect(created.user_id).toBe(7);
    expect(created.position_id).toBe(4);

    expect(JsonResource.collection([{ a: 1 }]).toResponse()).toEqual({ data: [{ a: 1 }] });
  });

  test("primaryKey defaults to id without an override", () => {
    const connection = new FakeConnection();
    const { UserModel } = createGraph(connection);
    class Tiny extends Model<User, "id"> {}
    registerModelRepository(Tiny, UserModel.repository());
    expect(new Tiny({ id: 1, name: "X", role_id: 1 }, UserModel.repository()).id).toBe(1);
  });
});
