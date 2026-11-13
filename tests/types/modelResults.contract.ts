import type { BoundModel } from "@getstrata/core/database/definitions";
/** Compiled against source and packed public declarations; not executed. */
import { Model } from "@getstrata/core/database/model";

interface ProductRecord {
  id: number;
  title: string;
  price: number;
}
class Product extends Model<ProductRecord, "id"> {
  label(): string {
    return this.get("title");
  }
}
class FeaturedProduct extends Product {
  featured(): boolean {
    return true;
  }
}

class ExternalProduct extends Model<{ sku: string; title: string }, "sku"> {
  protected override primaryKey(): "sku" {
    return "sku";
  }
}

export async function modelResultContracts(
  products: BoundModel<ProductRecord, "id", Product>,
  featuredProducts: BoundModel<ProductRecord, "id", FeaturedProduct>,
  externalProducts: BoundModel<{ sku: string; title: string }, "sku", ExternalProduct>,
): Promise<void> {
  const nullable: Array<Product | null> = [
    await products.find(1),
    await products.query().find(1),
    await products.query().first(),
    await products.firstWhere({ title: "book" }),
  ];
  const models: Product[] = [
    await products.findOrFail(1),
    await products.query().findOrFail(1),
    await products.create({ title: "book", price: 10 }),
    products.newFromRecord({ id: 1, title: "book", price: 10 }),
    await products.firstOrNew({ title: "book" }),
    await products.firstOrCreate({ title: "book" }),
    await products.updateOrCreate({ title: "book" }, { price: 10 }),
    ...(await products.all()),
    ...(await products.where({ price: 10 })),
    ...(await products.with("category").where({ price: 10 }).get()),
    ...(await products.withTrashed().get()),
    ...(await products.onlyTrashed().get()),
    ...(await products.whereHas("category").get()),
    ...(await products.has("category").get()),
    ...(await products.doesntHave("category").get()),
    ...(await products.whereDoesntHave("category").get()),
    ...(await products.query().orderBy({ title: "asc" }).paginate({ page: 1, perPage: 10 })).data,
    ...(await products.cursorPaginate({ perPage: 10 })).data,
  ];
  for (const model of [...models, ...nullable]) {
    if (!model) continue;
    const title: string = model.toObject().title;
    const price: number = model.get("price");
    const id: number = model.id;
    model.label();
    void [title, price, id];
    // @ts-expect-error Record fields retain their declared type.
    const badPrice: string = model.toObject().price;
    // @ts-expect-error Unknown fields are not invented by hydration.
    model.get("missing");
    // @ts-expect-error Plain products do not gain subclass methods.
    model.featured();
    void badPrice;
  }
  // @ts-expect-error find may return null.
  const nonNullable: Product = await products.find(1);
  void nonNullable;
  await products.chunk(10, async (items) => {
    for (const item of items) item.label();
  });
  await products.query().then((items) => {
    for (const item of items) item.label();
  });
  const external = await externalProducts.findOrFail("sku-1");
  const sku: string = external.id;
  void sku;
  const featured: FeaturedProduct = await featuredProducts.findOrFail(1);
  featured.featured();
  const counted = await products.query().withCount("reviews").withCount("orders", "sales").first();
  if (counted) {
    const reviews: unknown = counted.toObject().reviews_count;
    const sales: unknown = counted.get("sales");
    counted.label();
    const title: string = counted.toObject().title;
    const concrete: Product = counted;
    void [title, concrete];
    // @ts-expect-error SQL count scalar representations depend on the driver and model casts.
    const assumedNumber: number = counted.toObject().reviews_count;
    void assumedNumber;
    // @ts-expect-error Only the declared count alias is added.
    counted.toObject().orders_count;
    void [reviews, sales];
  }
  // Dynamic SQL projections remain explicitly untyped escape hatches.
  const values: unknown[] = await products.query().pluck("price");
  const projected: unknown = await products.value("price");
  void [values, projected];
}
