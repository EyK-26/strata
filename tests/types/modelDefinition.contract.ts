/** Compiled against source and packed declarations; not executed. */
import { defineModel } from "@getstrata/core/database/model";
import { defineTable } from "@getstrata/core/database/table";

const table = defineTable<{ sku: string; price: number }, "sku">({
  name: "products",
  primaryKey: "sku",
  columns: ["sku", "price"],
});
class Product extends defineModel(table) {
  price(): number {
    return this.get("price");
  }
}
class FeaturedProduct extends Product {
  featured() {
    return true;
  }
}
export async function declarativeModelContracts() {
  const product: Product = await Product.findOrFail("sku");
  const sku: string = product.id;
  const price: number = product.toObject().price;
  const featured: FeaturedProduct = await FeaturedProduct.create({ sku, price });
  featured.featured();
  // @ts-expect-error The declared primary key is a string.
  const id: number = product.id;
  // @ts-expect-error Unknown attributes are rejected.
  product.get("missing");
  // @ts-expect-error Table columns must belong to the record.
  defineTable<{ sku: string }, "sku">({ name: "bad", primaryKey: "sku", columns: ["missing"] });
  void id;
}
