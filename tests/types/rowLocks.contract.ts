import { BaseRepository, type DatabaseConnection } from "@getstrata/core/database/baseRepository";
import { defineModel } from "@getstrata/core/database/model";
import { defineTable } from "@getstrata/core/database/table";

const table = defineTable<{ id: number; stock: number }, "id">({
  name: "stock",
  primaryKey: "id",
  columns: ["id", "stock"],
});
class Stock extends defineModel(table) {}
export async function lockContracts(): Promise<void> {
  const row: Stock | null = await Stock.query().where({ id: 1 }).lockForUpdate().first();
  const projection: { stock: number } | null = await Stock.query()
    .sharedLock({ wait: "nowait" })
    .select("stock")
    .first();
  void row;
  void projection;
  // @ts-expect-error Invalid wait mode cannot be admitted by typed consumers.
  Stock.query().lockForUpdate({ wait: "forever" });
}

class ScopedStockRepository extends BaseRepository<{ id: number; stock: number }, "id"> {
  readonly #scope: string;

  constructor(connection: DatabaseConnection, scope: string) {
    super(table, connection);
    this.#scope = scope;
  }

  protected override cloneWithConnection(connection: DatabaseConnection): this {
    return new ScopedStockRepository(connection, this.#scope) as this;
  }

  scope(): string {
    return this.#scope;
  }
}

/** Compiled against source and packed exports; the construction hook stays protected. */
export function repositoryRebindingContract(connection: DatabaseConnection): void {
  const repository = new ScopedStockRepository(connection, "app-owned");
  const rebound: ScopedStockRepository = repository.withConnection(connection);
  const scope: string = rebound.scope();
  void scope;
  // @ts-expect-error Consumers rebind through the public entrypoint, not the protected hook.
  repository.cloneWithConnection(connection);
}
