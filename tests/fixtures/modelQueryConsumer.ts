/** Installed consumer of the public ModelQuery/projection facade; uses the migrated app table. */
import assert from "node:assert/strict";
import { valueService } from "@getstrata/core/contracts/services";
import { createServiceToken } from "@getstrata/core/contracts/token";
import { BaseRepository } from "@getstrata/core/database/baseRepository";
import { createDatabaseBindings } from "@getstrata/core/database/bindings";
import {
  defineModel,
  defineRepository,
  type ModelObserver,
} from "@getstrata/core/database/definitions";
import { Model, ModelQuery } from "@getstrata/core/database/model";
import { hasMany } from "@getstrata/core/database/relationships";
import { defineTable } from "@getstrata/core/database/table";
import { DATABASE_SESSION_TOKEN } from "@getstrata/core/database/tokens";
import { createApplication } from "@getstrata/core/runtime/application";

type Row = { id: number; scope: string; label: string };
const table = defineTable<Row, "id">({
  name: "rebinding_items",
  primaryKey: "id",
  columns: ["id", "scope", "label"],
});
const retrieved: number[] = [];
class QueryEntryEntity extends Model<Row, "id"> {
  label() {
    return this.get("label");
  }
}
const repository = defineRepository({
  name: "query-entry",
  table,
  dependencies: [],
  create: (binding) => new BaseRepository(binding),
});
const Observer = createServiceToken<ModelObserver<QueryEntryEntity>>("query-entry.retrieved");
const definition = defineModel({
  name: "QueryEntry",
  repository,
  dependencies: [],
  attributes: { fillable: ["scope", "label"], timestamps: false },
  observers: [Observer],
  scopes: [(query) => query.where({ scope: "query-visible" })],
  construct: (state, binding) => new QueryEntryEntity(state, binding),
});
const driver = process.env.DB_CONNECTION;
const url = process.env.DATABASE_URL;
assert.ok(url, "The installed fixture requires its migrated runtime URL.");
assert.ok(driver === "sqlite" || driver === "mysql" || driver === "pgsql");
const connection: Parameters<typeof createDatabaseBindings>[0]["connections"][string] =
  driver === "sqlite" ? { driver, filename: url.slice("sqlite:".length) } : { driver, url, max: 2 };
const app = createApplication({
  providers: [],
  services: [
    valueService(Observer, { retrieved: (entity) => retrieved.push(Number(entity.id)) }),
    ...createDatabaseBindings({
      default: "main",
      connections: { main: connection },
      repositories: [repository],
      models: [definition],
    }),
  ],
});
await app.start();
try {
  await app.run(async (scope) => {
    const QueryEntry = scope.resolve(DATABASE_SESSION_TOKEN).model(definition);
    const first = await QueryEntry.create({ scope: "query-visible", label: "query first" });
    await QueryEntry.create({ scope: "query-hidden", label: "query hidden" });
    const last = await QueryEntry.create({ scope: "query-visible", label: "query last" });
    const orderBy = [{ column: "id", direction: "asc" }] as const;
    const projected = await QueryEntry.query()
      .select("label")
      .keysetPaginate({ perPage: 1, orderBy });
    assert.deepEqual(projected.data, [{ label: "query first" }]);
    const projectedRow = projected.data[0];
    assert.ok(projectedRow);
    assert.equal("save" in projectedRow, false);
    assert.ok(projected.meta.next_cursor);
    assert.deepEqual(retrieved, []);
    const second = await QueryEntry.query().select("label").keysetPaginate({
      perPage: 1,
      orderBy,
      cursor: projected.meta.next_cursor,
    });
    assert.deepEqual(second.data, [{ label: "query last" }]);
    assert.equal(await QueryEntry.query().count(), 2);
    const page = await QueryEntry.query().keysetPaginate({ perPage: 1, orderBy });
    assert.ok(page.data[0] instanceof QueryEntryEntity);
    assert.equal(page.data[0]?.label(), "query first");
    assert.deepEqual(retrieved, [first.id]);

    const grouped = await QueryEntry.where({ id: first.id })
      .withHasMany(
        "same_scope",
        hasMany<Row, Row>({ name: "same_scope", localKey: "scope", foreignKey: "scope" }),
        QueryEntry.repository(),
        { orderBy: { id: "asc" } },
      )
      .first();
    assert.ok(grouped instanceof QueryEntryEntity);
    assert.deepEqual(Reflect.get(grouped.toObject(), "same_scope"), [
      { id: first.id, scope: "query-visible", label: "query first" },
      { id: last.id, scope: "query-visible", label: "query last" },
    ]);

    const direct = new ModelQuery<QueryEntryEntity>(QueryEntry, QueryEntry.query().query);
    assert.ok(direct instanceof ModelQuery);
    const rows = await direct.where({ id: last.id });
    assert.ok(Array.isArray(rows));
    assert.ok(rows[0] instanceof QueryEntryEntity);
    assert.equal(rows[0].label(), "query last");
    assert.equal(await QueryEntry.query().find(-1), null);
    assert.equal(await QueryEntry.where({ id: -1 }).select("label").first(), null);
    const missing = new Error("consumer-owned missing record");
    await assert.rejects(
      QueryEntry.query().findOrFail(-1, () => missing),
      (error) => error === missing,
    );
    assert.throws(
      () => QueryEntry.query().with("missing"),
      /QueryEntry has no relation method missing\(\)\./,
    );
    console.log(
      "PASS installed public ModelQuery identity, protected scopes, projection cursors and errors",
    );
  });
} finally {
  await app.stop();
}
