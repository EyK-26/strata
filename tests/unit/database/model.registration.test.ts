import { describe, expect, test } from "bun:test";
import { service, valueService } from "@getstrata/core/contracts/services";
import { createServiceToken } from "@getstrata/core/contracts/token";
import { BaseRepository } from "@getstrata/core/database/baseRepository";
import { createDatabaseBindings } from "@getstrata/core/database/bindings";
import {
  defineModel,
  defineRepository,
  type ModelObserver,
} from "@getstrata/core/database/definitions";
import { Model } from "@getstrata/core/database/model";
import { defineTable } from "@getstrata/core/database/table";
import { DATABASE_SESSION_TOKEN } from "@getstrata/core/database/tokens";
import { createApplication } from "@getstrata/core/runtime/application";
import { withBoundDatabase } from "../../helpers/boundRepositoryHarness";

type Row = { id: number; label: string };
const table = defineTable<Row, "id">({
  name: "registration_rows",
  primaryKey: "id",
  columns: ["id", "label"],
});
const repository = defineRepository({
  name: "registration_rows",
  table,
  dependencies: [],
  create: (binding) => new BaseRepository(binding),
});
class Entity extends Model<Row, "id"> {}
const config = {
  default: "main",
  connections: { main: { driver: "sqlite" as const, filename: ":memory:" } },
  repositories: [repository],
};
async function schema(db: Parameters<Parameters<typeof withBoundDatabase>[1]>[0]) {
  await db.execute({
    text: "CREATE TABLE registration_rows (id INTEGER PRIMARY KEY, label TEXT)",
    params: [],
  });
}
describe("model registration and observer contracts", () => {
  test("duplicate aliases reject the whole declaration before any entity constructor executes", () => {
    const constructors: string[] = [];
    const make = (name: string) =>
      defineModel({
        name,
        aliases: ["registration-shared"],
        repository,
        dependencies: [],
        attributes: {},
        construct: (state, binding) => {
          constructors.push(name);
          return new Entity(state, binding);
        },
      });
    const first = make("First"),
      second = make("Second");
    expect(() => createDatabaseBindings({ ...config, models: [first, second] })).toThrow(
      "Duplicate model alias",
    );
    expect(constructors).toEqual([]);
    expect(() => createDatabaseBindings({ ...config, models: [first, first] })).toThrow(
      "Duplicate model",
    );
    expect(constructors).toEqual([]);
  });
  test("failed preparation leaves no partially registered observers or scopes in a fresh application", async () => {
    let attempts = 0;
    const hooks: string[] = [];
    const Before = createServiceToken<ModelObserver<Entity>>("before-prepared");
    const Prepared = createServiceToken<ModelObserver<Entity>>("prepared-observer");
    const definition = defineModel({
      name: "Retried",
      repository,
      dependencies: [],
      attributes: { fillable: ["id", "label"], timestamps: false },
      observers: [Before, Prepared],
      scopes: [(query) => query.where({ id: 1 })],
      construct: (state, binding) => new Entity(state, binding),
    });
    const declarations = () => [
      valueService(Before, { creating: () => hooks.push("before-prepared") }),
      service(Prepared, {
        lifetime: "application",
        dependencies: [],
        create: () => {
          const attempt = ++attempts;
          if (attempt === 1) throw new Error("registration preparation failed");
          return { creating: () => hooks.push(`prepared-${attempt}`) };
        },
      }),
      ...createDatabaseBindings({ ...config, models: [definition] }),
    ];
    const failed = createApplication({ providers: [], services: declarations() });
    await expect(failed.start()).rejects.toThrow("registration preparation failed");
    await failed.stop();
    expect(hooks).toEqual([]);
    const app = createApplication({ providers: [], services: declarations() });
    await app.start();
    try {
      await app.run(async (scope) => {
        const db = scope.resolve(DATABASE_SESSION_TOKEN);
        await schema(db);
        const model = db.model(definition);
        await model.create({ id: 1, label: "visible" });
        await model.create({ id: 2, label: "hidden" });
        expect(hooks).toEqual(["before-prepared", "prepared-2", "before-prepared", "prepared-2"]);
        expect((await model.query().get()).map((row) => row.id)).toEqual([1]);
        expect(attempts).toBe(2);
      });
    } finally {
      await app.stop();
    }
  });
  test("async observers run in order and cancellation stops later hooks before persistence", async () => {
    const hooks: string[] = [];
    const First = createServiceToken<ModelObserver<Entity>>("first");
    const Cancel = createServiceToken<ModelObserver<Entity>>("cancel");
    const Later = createServiceToken<ModelObserver<Entity>>("later");
    const definition = defineModel({
      name: "Cancelled",
      repository,
      dependencies: [],
      attributes: { fillable: ["id", "label"], timestamps: false },
      observers: [First, Cancel, Later],
      construct: (state, binding) => new Entity(state, binding),
    });
    const app = createApplication({
      providers: [],
      services: [
        valueService(First, {
          saving: async () => {
            await Promise.resolve();
            hooks.push("first-saving");
          },
        }),
        valueService(Cancel, {
          saving: () => {
            hooks.push("cancel-saving");
            return false;
          },
        }),
        valueService(Later, {
          saving: () => hooks.push("later-saving"),
          creating: () => hooks.push("creating"),
          created: () => hooks.push("created"),
          saved: () => hooks.push("saved"),
        }),
        ...createDatabaseBindings({ ...config, models: [definition] }),
      ],
    });
    await app.start();
    try {
      await app.run((scope) => schema(scope.resolve(DATABASE_SESSION_TOKEN)));
      await expect(
        app.run((scope) =>
          scope
            .resolve(DATABASE_SESSION_TOKEN)
            .model(definition)
            .create({ id: 1, label: "cancelled" }),
        ),
      ).rejects.toThrow("Cancelled.create() was cancelled by an observer.");
      expect(hooks).toEqual(["first-saving", "cancel-saving"]);
      await app.run(async (scope) =>
        expect(
          await scope
            .resolve(DATABASE_SESSION_TOKEN)
            .execute({ text: "SELECT * FROM registration_rows", params: [] }),
        ).toHaveLength(0),
      );
    } finally {
      await app.stop();
    }
  });
  test("observer ownership follows exact definitions for concrete parent and child entities", async () => {
    const hooks: string[] = [];
    class Child extends Entity {}
    const ParentObserver = createServiceToken<ModelObserver<Entity>>("parent");
    const ChildObserver = createServiceToken<ModelObserver<Child>>("child");
    const parent = defineModel({
      name: "Parent",
      repository,
      dependencies: [],
      attributes: { fillable: ["id", "label"], timestamps: false },
      observers: [ParentObserver],
      construct: (state, binding) => new Entity(state, binding),
    });
    const child = defineModel({
      name: "Child",
      repository,
      dependencies: [],
      attributes: { fillable: ["id", "label"], timestamps: false },
      observers: [ChildObserver],
      construct: (state, binding) => new Child(state, binding),
    });
    await withBoundDatabase(
      {
        definition: { ...config, models: [parent, child] },
        services: [
          valueService(ParentObserver, { creating: () => hooks.push("parent") }),
          valueService(ChildObserver, { creating: () => hooks.push("child") }),
        ],
      },
      async (db) => {
        await schema(db);
        await db.model(child).create({ id: 1, label: "child" });
        await db.model(parent).create({ id: 2, label: "parent" });
        expect(hooks).toEqual(["child", "parent"]);
        expect(db.model(child)).not.toBe(db.model(parent));
        expect(db.model(child).repository()).toBe(db.model(parent).repository());
      },
    );
  });
});
