import { beforeAll, describe, expect, test } from "bun:test";

const enabled = process.env.HIROAPP_TEST === "1";

import { randomUUID } from "node:crypto";
import { ServiceContainer } from "@getstrata/core/contracts/container";
import { Factory } from "@getstrata/core/database/factory";
import { EventBus } from "@getstrata/core/events";
import { JsonResource } from "@getstrata/core/http/resources";
import { bindDatabase } from "../bootstrap/database.ts";
import { applicationFactory } from "../db/factories/applicationFactory.ts";
import { departmentFactory } from "../db/factories/departmentFactory.ts";
import { userFactory } from "../db/factories/userFactory.ts";
import { ROLE, STATUS } from "../lib/roles.ts";
import { Application } from "../models/Application.ts";
import { Notification } from "../models/Notification.ts";
import { Position } from "../models/Position.ts";
import { User } from "../models/User.ts";
import { users } from "../modules/users/repository.ts";

beforeAll(() => {
  bindDatabase();
});

describe.skipIf(!enabled)("Laravel-shaped Model relations (HiroApp tables)", () => {
  test("await user.applications() is thenable and returns Application models", async () => {
    const candidate = await users.findByEmail("candidate@hiroapp.com");
    expect(candidate).toBeTruthy();
    const query = User.newFromRecord(candidate!).applications();
    expect(typeof query.get).toBe("function");
    expect(typeof query.create).toBe("function");
    expect(typeof (query as { then?: unknown }).then).toBe("function");
    const apps = await query;
    expect(Array.isArray(apps)).toBe(true);
    expect(apps.length).toBeGreaterThan(0);
    expect(Number(apps[0]!.get("user_id"))).toBe(candidate!.id);
  });

  test("User.position() is hasOne; Application.user/position/status are belongsTo", async () => {
    const candidate = await users.findByEmail("candidate@hiroapp.com");
    const apps = await User.newFromRecord(candidate!).applications();
    const application = apps[0]!;
    const owner = await application.user();
    expect(owner?.get("email")).toBe("candidate@hiroapp.com");
    const position = await application.position();
    expect(position).toBeTruthy();
    const status = await application.status();
    expect(status).toBeTruthy();
  });

  test("load() / loaded() cache hasOne position; department loads on the child", async () => {
    const recruiter = await users.findByEmail("recruiter@hiroapp.com");
    const model = User.newFromRecord(recruiter!);
    expect(model.loaded("position")).toBeUndefined();
    await model.load("position");
    const position = model.loaded<Position>("position");
    expect(position).toBeTruthy();
    await position!.load("department");
    expect(position?.loaded("department")).toBeTruthy();
    await model.load("position");
    expect(model.loaded("position")).toBeTruthy();
  });

  test("nested load('position.department') hydrates both relations", async () => {
    const recruiter = await users.findByEmail("recruiter@hiroapp.com");
    const model = User.newFromRecord(recruiter!);
    await model.load("position.department");
    const position = model.loaded<Position>("position");
    expect(position).toBeTruthy();
    expect(position?.loaded("department")).toBeTruthy();
  });

  test("User.whereHas('applications') uses EXISTS and returns matching users", async () => {
    const rows = await User.whereHas("applications").get();
    expect(rows.length).toBeGreaterThan(0);
    const emails = rows.map((row) => row.get("email"));
    expect(emails).toContain("candidate@hiroapp.com");
  });

  test("User.has / doesntHave / whereDoesntHave are present", async () => {
    const withApps = await User.has("applications").get();
    const without = await User.doesntHave("applications").get();
    const whereWithout = await User.whereDoesntHave("applications").get();
    expect(withApps.length).toBeGreaterThan(0);
    expect(without.length).toBeGreaterThan(0);
    expect(whereWithout.length).toBe(without.length);
  });

  test("Application.whereHas('position') threads belongsTo.where into EXISTS", async () => {
    const hiring = await Position.where({ hiring: true }).first();
    expect(hiring).toBeTruthy();
    const term = String(hiring!.get("name")).slice(0, 3);
    const rows = await Application.whereHas("position", (related) => {
      related.where?.({ name: { ilike: `%${term}%` } });
    }).get();
    expect(rows.length).toBeGreaterThan(0);
  });

  test("User.toArray() hides password ($hidden)", async () => {
    const candidate = await users.findByEmail("candidate@hiroapp.com");
    const json = User.newFromRecord(candidate!).toArray();
    expect(json.email).toBe("candidate@hiroapp.com");
    expect(json.password).toBeUndefined();
  });

  test("Model.with() / where() / first() are a hydrating ModelQuery", async () => {
    const eager = User.with("applications").where({ email: "candidate@hiroapp.com" });
    expect(typeof eager.get).toBe("function");
    expect(typeof eager.first).toBe("function");
    expect(typeof eager.where).toBe("function");
    expect(typeof eager.find).toBe("function");
    const found = await eager.first();
    expect(found?.get("email")).toBe("candidate@hiroapp.com");
    await found!.load("applications");
    expect((found!.loaded("applications") as unknown[]).length).toBeGreaterThan(0);
  });

  test("user.applications().create() sets the FK (Laravel hasMany create)", async () => {
    const candidate = await users.findByEmail("candidate@hiroapp.com");
    const hiring = await Position.where({ hiring: true }).first();
    expect(hiring).toBeTruthy();
    const created = await User.newFromRecord(candidate!)
      .applications()
      .create({
        position_id: 9_000_000 + (Date.now() % 1_000_000),
        status_id: STATUS.APPLIED,
        attachment_text: "parity-create",
        attachment_file: "https://example.com/parity",
      });
    expect(Number(created.get("user_id"))).toBe(candidate!.id);
    await Application.findOrFail(created.id).then((row) => row.delete());
  });

  test("primaryKey() defaults to the table PK; integer casts hydrate ids", async () => {
    const candidate = await users.findByEmail("candidate@hiroapp.com");
    const model = await User.find(candidate!.id);
    expect(model).toBeTruthy();
    expect(typeof model!.id).toBe("number");
    expect(typeof model!.get("role_id")).toBe("number");
    expect(model!.id).toBe(candidate!.id);
  });

  test("applications().count() is COUNT(*)", async () => {
    const candidate = await users.findByEmail("candidate@hiroapp.com");
    const count = await User.newFromRecord(candidate!).applications().count();
    const rows = await User.newFromRecord(candidate!).applications();
    expect(count).toBe(rows.length);
    expect(count).toBeGreaterThan(0);
  });

  test("User.notifications() is morphMany App\\Models\\User, not users", async () => {
    const candidate = await users.findByEmail("candidate@hiroapp.com");
    const created = (await User.newFromRecord(candidate!)
      .notifications()
      .create({
        id: randomUUID(),
        type: "App\\Notifications\\ContactUser",
        data: { text: "parity-morph" },
        read_at: null,
      })) as Notification;
    expect(created.get("notifiable_type")).toBe("App\\Models\\User");
    expect(created.get("notifiable_type")).not.toBe("users");
    expect(Number(created.get("notifiable_id"))).toBe(candidate!.id);
    const inbox = (await User.newFromRecord(candidate!).notifications()) as Notification[];
    expect(inbox.some((row) => row.id === created.id)).toBe(true);
    const owner = await created.notifiable();
    expect(owner?.get("email")).toBe("candidate@hiroapp.com");
    await created.delete();
  });

  test("Notification.notifiable() passes morph name notifiable, not imageable", () => {
    const named = new Notification(
      {
        id: "x",
        type: "App\\Notifications\\ContactUser",
        notifiable_type: "App\\Models\\User",
        notifiable_id: 1,
        data: {},
        read_at: null,
        created_at: null,
        updated_at: null,
      },
      Notification.repository(),
    ).notifiable();
    expect(named.relation.morphTypeKey).toBe("notifiable_type");
    expect(named.relation.morphIdKey).toBe("notifiable_id");
    expect(named.relation.name).toBe("notifiable");
  });
});

describe.skipIf(!enabled)("Factory Laravel shape", () => {
  test("count/state/sequence clone; count().make() returns an array", () => {
    const original = userFactory.state({ role_id: ROLE.CANDIDATE });
    const counted = original.count(3);
    const made = counted.make({ password: "x" });
    expect(Array.isArray(made)).toBe(true);
    expect(made).toHaveLength(3);
    const single = original.make({ password: "x" });
    expect(Array.isArray(single)).toBe(false);
    expect((single as { role_id: number }).role_id).toBe(ROLE.CANDIDATE);
  });

  test("afterCreating runs after persist via Model.create()", async () => {
    const seen: string[] = [];
    const created = await userFactory
      .state({
        first_name: "After",
        last_name: "Creating",
        email: `after.creating.${Date.now()}@hiroapp.com`,
        password: "password",
        role_id: ROLE.CANDIDATE,
      })
      .afterCreating((record) => {
        seen.push(record.email);
      })
      .create();
    expect(seen).toEqual([created.email]);
    await users.deleteById(created.id);
  });

  test("for(parent Model) infers user_id from the users table", async () => {
    const candidate = await users.findByEmail("candidate@hiroapp.com");
    const parent = User.newFromRecord(candidate!);
    const made = applicationFactory.for(parent).make();
    expect(made.user_id).toBe(candidate!.id);
    expect(() => applicationFactory.for({ id: 1 })).toThrow();
  });

  test("department count()+sequence() create() returns an array", async () => {
    const rows = await departmentFactory
      .sequence({ name: "Department of Parity A" }, { name: "Department of Parity B" })
      .count(2)
      .create();
    expect(Array.isArray(rows)).toBe(true);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.name).toBe("Department of Parity A");
    expect(rows[1]!.name).toBe("Department of Parity B");
    const { departments } = await import("../modules/departments/repository.ts");
    await departments.deleteById(rows[0]!.id);
    await departments.deleteById(rows[1]!.id);
  });

  test("applicationFactory.for(parent, foreignKey) still accepts an explicit FK", async () => {
    const candidate = await users.findByEmail("candidate@hiroapp.com");
    const hiring = await Position.where({ hiring: true }).first();
    const made = applicationFactory
      .for(candidate!, "user_id")
      .for({ id: hiring!.id }, "position_id")
      .make();
    expect(made.user_id).toBe(candidate!.id);
    expect(made.position_id).toBe(hiring!.id);
  });

  test("Factory.has() without an explicit FK fails when the parent persist is a plain record", async () => {
    const child = new (class extends Factory<{ user_id: number }> {
      protected definition() {
        return { user_id: 0 };
      }
      protected persist(): Promise<{ user_id: number }> {
        throw new Error("child persist should not run");
      }
    })();
    const email = `has.needsfk.${Date.now()}@hiroapp.com`;
    await expect(
      userFactory
        .has(child)
        .state({
          first_name: "Has",
          last_name: "NeedsFk",
          email,
          password: "password",
          role_id: ROLE.CANDIDATE,
        })
        .create(),
    ).rejects.toThrow();
    const leaked = await users.findByEmail(email);
    if (leaked) {
      await users.deleteById(leaked.id);
    }
  });
});

describe.skipIf(!enabled)("JsonResource vs Laravel HiroApp (Laravel had no Resources)", () => {
  test("collection toResponse wraps once: { data: [...] }", () => {
    class PositionResource extends JsonResource<{ name: string }> {
      toArray() {
        return { name: (this as unknown as { resource: { name: string } }).resource.name };
      }
    }
    const one = new PositionResource({ name: "Engineer" }).toResponse();
    expect(one).toEqual({ data: { name: "Engineer" } });
    const collection = JsonResource.collection([{ name: "A" }, { name: "B" }]).toResponse();
    expect(collection).toEqual({ data: [{ name: "A" }, { name: "B" }] });
  });
});

describe.skipIf(!enabled)("Container / events", () => {
  test("container.make / instance", () => {
    const container = new ServiceContainer();
    container.instance("answer", 42);
    expect(container.make("answer")).toBe(42);
  });

  test("events.on / emit are aliases of listen / dispatch", async () => {
    const bus = new EventBus();
    const seen: unknown[] = [];
    bus.on("ping", (payload) => {
      seen.push(payload);
    });
    await bus.emit("ping", { ok: true });
    expect(seen).toEqual([{ ok: true }]);
  });
});
