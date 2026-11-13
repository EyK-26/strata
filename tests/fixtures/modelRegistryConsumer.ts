/** Installed consumer of immutable definitions, explicit constructors and observer admission. */
import assert from "node:assert/strict";
import { valueService } from "@getstrata/core/contracts/services";
import { createServiceToken } from "@getstrata/core/contracts/token";
import { BaseRepository } from "@getstrata/core/database/baseRepository";
import { createDatabaseBindings } from "@getstrata/core/database/bindings";
import {
  defineModel,
  defineRepository,
  type ModelBinding,
  type ModelObserver,
  type ModelState,
} from "@getstrata/core/database/definitions";
import { Model } from "@getstrata/core/database/model";
import { defineTable } from "@getstrata/core/database/table";
import { DATABASE_SESSION_TOKEN } from "@getstrata/core/database/tokens";
import { createApplication } from "@getstrata/core/runtime/application";

type Row = { id: number; label: string };
const table = defineTable<Row, "id">({
  name: "qualification_registry",
  primaryKey: "id",
  columns: ["id", "label"],
});
const hooks: string[] = [];
class FirstEntity extends Model<Row, "id"> {
  constructor(state: ModelState<Row>, binding: ModelBinding<Row, "id", BaseRepository<Row, "id">>) {
    super(state, binding);
    hooks.push("first-construct");
  }
}
class ChildEntity extends FirstEntity {}
class RetriedEntity extends Model<Row, "id"> {}
const firstRepo = defineRepository({
  name: "FirstRepo",
  table,
  dependencies: [],
  create: (binding) => new BaseRepository(binding),
});
const childRepo = defineRepository({
  name: "ChildRepo",
  table,
  dependencies: [],
  create: (binding) => new BaseRepository(binding),
});
const First = defineModel({
  name: "First",
  aliases: ["qualification-shared"],
  repository: firstRepo,
  dependencies: [],
  attributes: { timestamps: false },
  construct: (state, binding) => new FirstEntity(state, binding),
});
const Second = defineModel({
  name: "Second",
  aliases: ["qualification-shared"],
  repository: childRepo,
  dependencies: [],
  attributes: { timestamps: false },
  construct: (state, binding) => new ChildEntity(state, binding),
});
const config = {
  default: "main",
  connections: { main: { driver: "sqlite" as const, filename: ":memory:" } },
};
assert.throws(
  () =>
    createDatabaseBindings({
      ...config,
      repositories: [firstRepo, childRepo],
      models: [First, Second],
    }),
  /Duplicate model alias/,
);
assert.deepEqual(hooks.slice(), []);
assert.throws(
  () => createDatabaseBindings({ ...config, repositories: [firstRepo], models: [First, First] }),
  /Duplicate model/,
);
const Child = defineModel({
  name: "Child",
  aliases: ["qualification-child"],
  repository: childRepo,
  dependencies: [],
  attributes: { timestamps: false },
  construct: (state, binding) => new ChildEntity(state, binding),
});
let attempts = 0;
const retriedRepo = defineRepository({
  name: "RetriedRepo",
  table,
  dependencies: [],
  create: (binding) => {
    if (++attempts === 1) throw new Error("qualification constructor failure");
    return new BaseRepository(binding);
  },
});
const before = createServiceToken<ModelObserver<RetriedEntity>>("before");
const attempt = createServiceToken<ModelObserver<RetriedEntity>>("attempt");
const cancel = createServiceToken<ModelObserver<RetriedEntity>>("cancel");
const after = createServiceToken<ModelObserver<RetriedEntity>>("after");
const Retried = defineModel({
  name: "Retried",
  repository: retriedRepo,
  dependencies: [],
  attributes: { fillable: ["id", "label"], timestamps: false },
  observers: [before, attempt, cancel, after],
  construct: (state, binding) => new RetriedEntity(state, binding),
});
const app = createApplication({
  providers: [],
  services: [
    valueService(before, {
      saving: () => {
        hooks.push("before-construct");
      },
    }),
    valueService(attempt, {
      saving: () => {
        hooks.push(`attempt-${attempts}`);
      },
    }),
    valueService(cancel, {
      saving: async () => {
        await Promise.resolve();
        hooks.push("cancel");
        return false;
      },
    }),
    valueService(after, {
      saving: () => {
        hooks.push("after-cancellation");
      },
    }),
    ...createDatabaseBindings({
      ...config,
      repositories: [firstRepo, childRepo, retriedRepo],
      models: [First, Child, Retried],
    }),
  ],
});
await app.start();
try {
  await app.run(async (scope) => {
    const database = scope.resolve(DATABASE_SESSION_TOKEN);
    const first = database.model(First),
      child = database.model(Child);
    first.newRecord({ id: 1 });
    assert.deepEqual(hooks, ["first-construct"]);
    assert.notEqual(first.repository(), child.repository());
    assert.equal(child.repository(), database.model(Child).repository());
    assert.throws(() => database.model(Retried), /qualification constructor failure/);
    const retried = database.model(Retried);
    assert.equal(database.model(Retried), retried);
    hooks.length = 0;
    await assert.rejects(
      retried.create({ id: 1, label: "never-persisted" }),
      /create\(\) was cancelled by an observer/,
    );
    assert.deepEqual(hooks, ["before-construct", "attempt-2", "cancel"]);
    assert.equal(attempts, 2);
  });
} finally {
  await app.stop();
}
console.log("PASS installed Model registration, retry, concrete identity and observer admission");
