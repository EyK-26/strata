/** Compiled against source and packed public declarations; never executed. */
import { BaseRepository } from "@getstrata/core/database/baseRepository";
import type { BoundModel, RepositoryBinding } from "@getstrata/core/database/definitions";
import { Model } from "@getstrata/core/database/model";
import { defineTable } from "@getstrata/core/database/table";
import type { ModelWhere, ModelWriteValues } from "@getstrata/core/database/types";

type Row = {
  id: number;
  title: string;
  price: number;
  active: boolean;
  note: string | null;
  created_at: Date;
};
export const modelInputTable = defineTable<Row, "id">({
  name: "products",
  primaryKey: "id",
  columns: ["id", "title", "price", "active", "note", "created_at"],
});
class Product extends Model<Row, "id"> {
  label(): string {
    return this.get("title");
  }
}
class Featured extends Product {
  featured(): boolean {
    return true;
  }
}
class CustomRepository extends BaseRepository<Row, "id"> {
  custom(): boolean {
    return true;
  }
}
class Legacy extends Model<Row, "id"> {}

export async function modelInputContracts(
  products: BoundModel<Row, "id", Product>,
  featured: BoundModel<Row, "id", Featured>,
  legacy: BoundModel<Row, "id", Legacy>,
  binding: RepositoryBinding<Row, "id">,
): Promise<void> {
  // Defaults/generated/timestamp/nullable columns need not be provided on every write.
  const input: ModelWriteValues<Row> = { title: "book", price: 10, note: null };
  const product: Product = await products.create(input, { active: true });
  const subclass: Featured = await featured.create({ title: "book" });
  subclass.featured();
  product.label();
  await legacy.create({ title: "legacy" });
  await products.firstOrNew({ title: "book" }, { note: null });
  await products.firstOrCreate({ title: "book" }, { price: 10 });
  await products.updateOrCreate({ title: "book" }, { price: 12 });
  await products.where({ price: { gte: 10 }, active: true, note: { isNull: true } }).get();
  await products
    .query()
    .where((builder) =>
      builder
        .where({ title: { ilike: "%book%" } })
        .orWhereGroup((nested) => nested.where({ price: { in: [1, 2] } })),
    )
    .get();
  await products
    .query()
    .whereIn("price", [1, 2])
    .whereNotIn("title", ["other"])
    .whereNull("note")
    .whereNotNull("title")
    .orderBy({ price: "desc" })
    .get();
  const where: ModelWhere<Row> = { note: null };
  await products.firstWhere(where, { orderBy: { column: "id", direction: "asc" } });
  await products.all({ orderBy: { id: "desc" } });
  products.newFromRecord({
    id: 1,
    title: "book",
    price: 10,
    active: true,
    note: null,
    created_at: new Date(),
  });
  // Explicitly trusted driver or partial records remain supported.
  products.newFromTrustedRecord({ id: 1, title: "partial" });
  products.newFromRecord({ title: "unsaved" }, false);
  await products
    .query()
    .whereDynamic({ "products.price": { gte: 10 } })
    .get();
  const repo = new CustomRepository(binding);
  repo.custom();
  await repo.upsert({ title: "bulk" }, ["id"]);
  await repo
    .query()
    .where({ "products.price": { gte: 10 } })
    .project(["id", "title"]);
  const projection = products.query().where({ active: true }).select("title", "price");
  const rows: Array<Pick<Row, "title" | "price">> = await projection.get();
  const first = await projection.first();
  if (first) {
    const title: string = first.title;
    const price: number = first.price;
    void [title, price];
    // @ts-expect-error A selected plain record is not a complete model.
    first.save();
    // @ts-expect-error Unselected fields are not promised.
    first.created_at;
  }
  // @ts-expect-error Unknown write column.
  await products.create({ titel: "book" });
  // @ts-expect-error Wrong write scalar.
  await products.create({ price: "10" });
  // @ts-expect-error Forced attributes still have declared types.
  await products.create({ title: "book" }, { active: 1 });
  // @ts-expect-error Nonnullable strings do not accept null.
  await products.create({ title: null });
  // @ts-expect-error Unknown query key.
  await products.where({ prcie: 10 });
  // @ts-expect-error Scalar values follow the field type.
  await products.where({ price: "10" });
  // @ts-expect-error Operator values follow the field type.
  await products.query().where({ price: { gte: "10" } });
  // @ts-expect-error In operators follow the field type.
  await products.query().where({ active: { in: [1] } });
  await products.query().where((builder) =>
    // @ts-expect-error Nested builders keep their typed filter.
    builder.whereGroup((nested) => nested.where({ price: "10" })),
  );
  // @ts-expect-error In helper values follow the selected field.
  products.query().whereIn("price", ["10"]);
  // @ts-expect-error Helpers reject unknown columns.
  products.query().whereNull("missing");
  // @ts-expect-error Order helpers reject unknown columns.
  products.query().orderBy({ missing: "asc" });
  // @ts-expect-error Find-or-create does not bypass write typing.
  products.firstOrCreate({ title: "book" }, { price: "10" });
  // @ts-expect-error Checked hydration requires a full declared row.
  products.newFromRecord({ id: 1, title: "partial" });
  products.newFromRecord({
    id: 1,
    title: "book",
    // @ts-expect-error Checked hydration rejects wrong scalar values.
    price: "10",
    active: true,
    note: null,
    created_at: new Date(),
  });
  // @ts-expect-error Partial SQL select cannot be requested as full models through all().
  products.all({ select: [{ kind: "column", table: "products", column: "title" }] });
  // @ts-expect-error Unknown projection fields are rejected.
  products.query().select("missing");
  // @ts-expect-error Repository projections retain selected fields only.
  (await repo.query().project(["title"]))[0]?.price;
  // @ts-expect-error Numeric primary keys reject strings.
  await products.find("wrong-key");
  // @ts-expect-error Query primary keys retain their type.
  await products.query().findOrFail("wrong-key");
  void rows;
}
