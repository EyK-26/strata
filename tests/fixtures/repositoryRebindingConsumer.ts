/** Installed explicit repository consumer; no source aliases or ambient persistence. */
import assert from "node:assert/strict";
import { valueService } from "@getstrata/core/contracts/services";
import { createServiceToken } from "@getstrata/core/contracts/token";
import { BaseRepository } from "@getstrata/core/database/baseRepository";
import { createDatabaseBindings } from "@getstrata/core/database/bindings";
import {
  type AfterCommitRepositoryListener,
  defineRepository,
  type RepositoryBinding,
} from "@getstrata/core/database/definitions";
import type { DatabaseConnectionOptions } from "@getstrata/core/database/session";
import { defineTable } from "@getstrata/core/database/table";
import { DATABASE_SESSION_TOKEN } from "@getstrata/core/database/tokens";
import { createApplication } from "@getstrata/core/runtime/application";
import { createModelWriteHookFixture } from "./modelWriteHookConsumer.ts";

type Item = { id: number; scope: string; label: string };
const table = defineTable<Item, "id">({
  name: "rebinding_items",
  primaryKey: "id",
  columns: ["id", "scope", "label"],
});
const url = process.env.DATABASE_URL;
assert.ok(url, "The generated fixture must provide its restricted runtime URL.");
const driver = process.env.DB_CONNECTION;
assert.ok(driver === "sqlite" || driver === "mysql" || driver === "pgsql");
const connection: DatabaseConnectionOptions =
  driver === "sqlite" ? { driver, filename: url.replace(/^sqlite:/, "") } : { driver, url, max: 2 };
class ScopedItems extends BaseRepository<Item, "id"> {
  readonly #scope: string;
  readonly label = "application-owned repository";
  constructor(binding: RepositoryBinding<Item, "id">, scope: string) {
    super(binding);
    this.#scope = scope;
  }
  findScoped() {
    return this.findAll({ where: { scope: this.#scope }, orderBy: { id: "ASC" } });
  }
}
let constructions = 0;
class ExplicitItems extends BaseRepository<Item, "id"> {
  readonly label = "explicit own state";
  constructor(binding: RepositoryBinding<Item, "id">) {
    super(binding);
    constructions++;
  }
  inheritedLabel() {
    return this.label;
  }
}
const events: unknown[] = [];
const listener = createServiceToken<AfterCommitRepositoryListener<Item>>("items.created");
const scoped = defineRepository({
  name: "ScopedItems",
  table,
  dependencies: [],
  create: (binding) => new ScopedItems(binding, "north"),
  effects: [{ action: "created", afterCommit: listener }],
});
const explicit = defineRepository({
  name: "ExplicitItems",
  table,
  dependencies: [],
  create: (binding) => new ExplicitItems(binding),
});
const plain = defineRepository({
  name: "PlainItems",
  table,
  dependencies: [],
  create: (binding) => new BaseRepository(binding),
});
const hooks = createModelWriteHookFixture();
const app = createApplication({
  providers: [],
  services: [
    valueService(listener, (row) => {
      events.push(row);
    }),
    ...createDatabaseBindings({
      default: "primary",
      connections: { primary: connection, secondary: connection },
      repositories: [scoped, explicit, plain, ...hooks.repositories],
      models: hooks.models,
    }),
  ],
});
function assertRows(actual: readonly Item[], expected: readonly Item[]): void {
  assert.ok(Array.isArray(actual));
  assert.equal(actual.length, expected.length);
  for (const [index, row] of expected.entries()) assert.deepEqual(actual[index], row);
}
await app.start();
try {
  await app.run(async (scope) => {
    const primary = scope.resolve(DATABASE_SESSION_TOKEN),
      secondary = primary.connection("secondary");
    assert.notEqual(primary, secondary);
    const firstExplicit = primary.repository(explicit),
      secondExplicit = secondary.repository(explicit);
    assert.ok(secondExplicit instanceof ExplicitItems);
    assert.equal(secondExplicit.inheritedLabel(), "explicit own state");
    assert.equal(constructions, 2, "Explicit attachment constructs each instance deliberately.");
    assert.equal(primary.repository(explicit), firstExplicit);
    assert.equal(secondary.repository(explicit), secondExplicit);
    const original = primary.repository(scoped),
      first = primary.repository(scoped),
      second = secondary.repository(scoped);
    assert.ok(first instanceof ScopedItems);
    assert.ok(second instanceof ScopedItems);
    assert.equal(first, original);
    assert.notEqual(first, second);
    assert.equal(second.label, original.label);
    assert.equal(second.getTable(), original.getTable());
    const rollback = new Error("Roll back the application's rebound write");
    await assert.rejects(
      primary.transaction(async (transaction) => {
        const bound = transaction.repository(scoped);
        assert.notEqual(bound, original);
        const inserted = await bound.create({ scope: "north", label: "uncommitted" });
        assertRows(await bound.findScoped(), [inserted]);
        assert.deepEqual(events, [], "Events must remain deferred before rollback.");
        throw rollback;
      }),
      (error) => error === rollback,
    );
    assertRows(await original.findScoped(), []);
    assertRows(await second.findScoped(), []);
    assert.deepEqual(events, [], "Rolled-back writes must not publish model events.");
    const committed = await secondary.transaction(async (transaction) => {
      const inserted = await transaction
        .repository(scoped)
        .create({ scope: "north", label: "committed" });
      assert.deepEqual(events, [], "Events must remain deferred until native commit.");
      return inserted;
    });
    assert.deepEqual(events, [committed]);
    const outsideScope = await primary
      .repository(plain)
      .create({ scope: "south", label: "another business scope" });
    assert.notEqual(outsideScope.id, committed.id);
    const concurrent = await Promise.all([
      first.findScoped(),
      second.findScoped(),
      original.findScoped(),
    ]);
    assert.equal(concurrent.length, 3);
    for (const rows of concurrent) assertRows(rows, [committed]);
    assert.equal(primary.repository(scoped), original);
    assert.equal(secondary.repository(scoped), second);
    assert.deepEqual(await secondExplicit.findById(committed.id), committed);
    if (process.env.STRATA_QUALIFY_MODEL_WRITE_HOOKS === "true") {
      await hooks.verify(primary);
      console.log(
        `PASS installed model write hooks ${driver}: sync/async dispatch, stale fields, failure and retry`,
      );
    }
    console.log(
      `PASS installed repository binding ${driver}: private state, independent bindings, rollback and commit events`,
    );
  });
} finally {
  await app.stop();
}
