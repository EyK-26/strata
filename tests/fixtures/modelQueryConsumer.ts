/** Installed consumer of the public ModelQuery/projection facade; uses the migrated app table. */
import assert from "node:assert/strict";
import type { InitializedAppContext } from "@getstrata/bootstrap/context";
import { defineModel, ModelQuery } from "@getstrata/core/database/model";
import { hasMany } from "@getstrata/core/database/relationships";
import { defineTable } from "@getstrata/core/database/table";

type Row = { id: number; scope: string; label: string };
const table = defineTable<Row, "id">({
  name: "rebinding_items",
  primaryKey: "id",
  columns: ["id", "scope", "label"],
});
const retrieved: number[] = [];
class QueryEntry extends defineModel(table) {
  static override $fillable = ["scope", "label"];
  static override $timestamps = false;
  static override boot() {
    QueryEntry.addGlobalScope<Row, "id">("visible", (query) =>
      query.where({ scope: "query-visible" }),
    );
    QueryEntry.observe({ retrieved: (model) => retrieved.push(Number(model.id)) });
  }
  label() {
    return this.get("label");
  }
}
// The generated bootstrap is typechecked in the app and owns connection/dialect setup.
const application: {
  createApp(options: { migrate: false }): Promise<{ context: InitializedAppContext }>;
} = await import(new URL("../bootstrap/createApp.ts", import.meta.url).href);
const app = await application.createApp({ migrate: false });
try {
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
  assert.ok(page.data[0] instanceof QueryEntry);
  assert.equal(page.data[0]?.label(), "query first");
  assert.deepEqual(retrieved, [first.id]);

  const grouped = await QueryEntry.where({ id: first.id })
    .withHasMany(
      "same_scope",
      hasMany<Row, Row>({ name: "same_scope", localKey: "scope", foreignKey: "scope" }),
      QueryEntry.repository<Row, "id">(),
      { orderBy: { id: "asc" } },
    )
    .first();
  assert.ok(grouped instanceof QueryEntry);
  assert.deepEqual(Reflect.get(grouped.toObject(), "same_scope"), [
    { id: first.id, scope: "query-visible", label: "query first" },
    { id: last.id, scope: "query-visible", label: "query last" },
  ]);

  const direct = new ModelQuery<QueryEntry>(QueryEntry, QueryEntry.query().query);
  assert.ok(direct instanceof ModelQuery);
  const rows = await direct.where({ id: last.id });
  assert.ok(Array.isArray(rows));
  assert.ok(rows[0] instanceof QueryEntry);
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
} finally {
  await app.context.dispose();
}
