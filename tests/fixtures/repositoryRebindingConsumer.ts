/** Copied into a generated app, then typechecked and run against installed packages. */
import assert from "node:assert/strict";
import { BaseRepository, type DatabaseConnection } from "@getstrata/core/database/baseRepository";
import { createBunSqlPool } from "@getstrata/core/database/bunSql";
import { useSqlDialect } from "@getstrata/core/database/dialect";
import { createMysqlConnection } from "@getstrata/core/database/mysqlConnection";
import { createSqliteConnection } from "@getstrata/core/database/sqliteConnection";
import { defineTable } from "@getstrata/core/database/table";
import { runInTransaction } from "@getstrata/core/database/transaction";
import { eventBus } from "@getstrata/core/events";

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
useSqlDialect(driver);

function connect(url: string, driver: "sqlite" | "mysql" | "pgsql"): DatabaseConnection {
  if (driver === "sqlite") return createSqliteConnection(url.slice("sqlite:".length));
  if (driver === "mysql") return createMysqlConnection(url);
  return createBunSqlPool({ url, max: 2 });
}

class ScopedItems extends BaseRepository<Item, "id"> {
  readonly #scope: string;
  readonly label = "application-owned repository";

  constructor(connection: DatabaseConnection, scope: string) {
    super(table, connection);
    this.#scope = scope;
  }

  protected override cloneWithConnection(connection: DatabaseConnection): this {
    // This concrete application class owns construction of its native private state.
    return new ScopedItems(connection, this.#scope) as this;
  }

  findScoped() {
    return this.findWhere({ scope: this.#scope }, { orderBy: { id: "ASC" } });
  }
}

let legacyConstructions = 0;
class LegacyItems extends BaseRepository<Item, "id"> {
  readonly label = "legacy own state";
  constructor(connection: DatabaseConnection) {
    super(table, connection);
    legacyConstructions++;
  }

  inheritedLabel() {
    return this.label;
  }
}

const primary = connect(url, driver);
const secondary = connect(url, driver);
const events: unknown[] = [];
const stop = eventBus.listen("rebinding_items.created", (item) => {
  events.push(item);
});

function assertRows(actual: readonly Item[], expected: readonly Item[]): void {
  // Native PostgreSQL returns an Array subclass with command metadata. The public
  // repository contract promises rows, not an identical driver-container prototype.
  assert.ok(Array.isArray(actual));
  assert.equal(actual.length, expected.length);
  for (const [index, row] of expected.entries()) assert.deepEqual(actual[index], row);
}

try {
  assert.notEqual(primary, secondary);
  const legacy = new LegacyItems(primary);
  const legacyCopy = legacy.withConnection(secondary);
  assert.ok(legacyCopy instanceof LegacyItems);
  assert.equal(legacyCopy.inheritedLabel(), "legacy own state");
  assert.equal(legacyConstructions, 1, "Default rebinding must not rerun constructors.");
  assert.equal(legacy.getConnection(), primary);
  assert.equal(legacyCopy.getConnection(), secondary);

  const original = new ScopedItems(primary, "north");
  const first = original.withConnection(primary);
  const second = original.withConnection(secondary);
  assert.ok(first instanceof ScopedItems);
  assert.ok(second instanceof ScopedItems);
  assert.notEqual(first, original);
  assert.notEqual(first, second);
  assert.equal(second.label, original.label);
  assert.equal(second.getTable(), original.getTable());
  assert.equal(first.getConnection(), primary);
  assert.equal(second.getConnection(), secondary);
  assert.equal(original.getConnection(), primary);

  const rollback = new Error("Roll back the application's rebound write");
  await assert.rejects(
    runInTransaction(
      async (transaction) => {
        const rebound = original.withConnection(transaction);
        assert.equal(rebound.getConnection(), transaction);
        const inserted = await rebound.create({ scope: "north", label: "uncommitted" });
        assertRows(await rebound.findScoped(), [inserted]);
        assert.deepEqual(events, [], "Events must remain deferred before rollback.");
        throw rollback;
      },
      { connection: primary },
    ),
    (error) => error === rollback,
  );
  assertRows(await original.findScoped(), []);
  assertRows(await second.findScoped(), []);
  assert.deepEqual(events, [], "Rolled-back writes must not publish model events.");

  const committed = await runInTransaction(
    async (transaction) => {
      const inserted = await second
        .withConnection(transaction)
        .create({ scope: "north", label: "committed" });
      assert.deepEqual(events, [], "Events must remain deferred until native commit.");
      return inserted;
    },
    { connection: secondary },
  );
  assert.deepEqual(events, [committed]);
  const outsideScope = await new BaseRepository(table, primary).create({
    scope: "south",
    label: "another business scope",
  });
  assert.notEqual(outsideScope.id, committed.id);
  const concurrent = await Promise.all([
    first.findScoped(),
    second.findScoped(),
    original.findScoped(),
  ]);
  assert.equal(concurrent.length, 3);
  for (const rows of concurrent) assertRows(rows, [committed]);
  assert.equal(original.getConnection(), primary);
  assert.equal(first.getConnection(), primary);
  assert.equal(second.getConnection(), secondary);
  assert.deepEqual(await legacyCopy.findById(committed.id), committed);
  console.log(
    `PASS installed repository rebinding ${driver}: private state, independent bindings, rollback and commit events`,
  );
} finally {
  stop();
  try {
    await secondary.close?.();
  } finally {
    await primary.close?.();
  }
}
