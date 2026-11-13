import { BaseRepository } from "@getstrata/core/database/baseRepository";
import { defineModel, defineRepository } from "@getstrata/core/database/definitions";
/** Compiled against source and packed declarations; not executed. */
import { Model } from "@getstrata/core/database/model";
import type { DatabaseSession } from "@getstrata/core/database/session";
import { defineTable } from "@getstrata/core/database/table";

const table = defineTable<{ sku: string; price: number }, "sku">({
  name: "products",
  primaryKey: "sku",
  columns: ["sku", "price"],
});
class Product extends Model<{ sku: string; price: number }, "sku"> {
  price(): number {
    return this.get("price");
  }
}
class FeaturedProduct extends Product {
  featured() {
    return true;
  }
}
const repository = defineRepository({
  name: "products",
  table,
  dependencies: [],
  create: (binding) => new BaseRepository(binding),
});
const productDefinition = defineModel({
  name: "Product",
  repository,
  dependencies: [],
  attributes: { guarded: [] },
  construct: (state, binding) => new Product(state, binding),
});
const featuredDefinition = defineModel({
  name: "FeaturedProduct",
  repository,
  dependencies: [],
  attributes: { guarded: [] },
  construct: (state, binding) => new FeaturedProduct(state, binding),
});
export async function declarativeModelContracts(database: DatabaseSession) {
  const products = database.model(productDefinition);
  const featuredProducts = database.model(featuredDefinition);
  const product: Product = await products.findOrFail("sku");
  const sku: string = product.id;
  const price: number = product.toObject().price;
  const featured: FeaturedProduct = await featuredProducts.create({ sku, price });
  featured.featured();
  // @ts-expect-error The declared primary key is a string.
  const id: number = product.id;
  // @ts-expect-error Unknown attributes are rejected.
  product.get("missing");
  // @ts-expect-error Table columns must belong to the record.
  defineTable<{ sku: string }, "sku">({ name: "bad", primaryKey: "sku", columns: ["missing"] });
  void id;
}
