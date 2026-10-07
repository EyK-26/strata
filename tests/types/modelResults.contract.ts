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

export async function modelResultContracts(): Promise<void> {
  const nullable: Array<Product | null> = [
    await Product.find(1),
    await Product.query().find(1),
    await Product.query().first(),
    await Product.firstWhere({ title: "book" }),
  ];
  const models: Product[] = [
    await Product.findOrFail(1),
    await Product.query().findOrFail(1),
    await Product.create({ title: "book", price: 10 }),
    Product.newFromRecord({ id: 1, title: "book", price: 10 }),
    await Product.firstOrNew({ title: "book" }),
    await Product.firstOrCreate({ title: "book" }),
    await Product.updateOrCreate({ title: "book" }, { price: 10 }),
    ...(await Product.all()),
    ...(await Product.where({ price: 10 })),
    ...(await Product.with("category").where({ price: 10 }).get()),
    ...(await Product.withTrashed().get()),
    ...(await Product.onlyTrashed().get()),
    ...(await Product.whereHas("category").get()),
    ...(await Product.has("category").get()),
    ...(await Product.doesntHave("category").get()),
    ...(await Product.whereDoesntHave("category").get()),
    ...(await Product.query().orderBy({ title: "asc" }).paginate({ page: 1, perPage: 10 })).data,
    ...(await Product.cursorPaginate({ perPage: 10 })).data,
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
  const nonNullable: Product = await Product.find(1);
  void nonNullable;
  await Product.chunk(10, async (items) => {
    for (const item of items) item.label();
  });
  await Product.query().then((items) => {
    for (const item of items) item.label();
  });
  const external = await ExternalProduct.findOrFail("sku-1");
  const sku: string = external.id;
  void sku;
  const featured: FeaturedProduct = await FeaturedProduct.findOrFail(1);
  featured.featured();
  const counted = await Product.query().withCount("reviews").withCount("orders", "sales").first();
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
  const values: unknown[] = await Product.query().pluck("price");
  const projected: unknown = await Product.value("price");
  void [values, projected];
}
