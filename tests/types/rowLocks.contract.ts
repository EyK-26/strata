import { BaseRepository } from "@getstrata/core/database/baseRepository";
import { defineRepository, type RepositoryBinding } from "@getstrata/core/database/definitions";
import { defineModel, Model } from "@getstrata/core/database/model";
import type { DatabaseSession, TransactionSession } from "@getstrata/core/database/session";
import { defineTable } from "@getstrata/core/database/table";

const table = defineTable<{ id: number; stock: number }, "id">({
  name: "stock",
  primaryKey: "id",
  columns: ["id", "stock"],
});
class Stock extends Model<{ id: number; stock: number }, "id"> {}
const repositoryDefinition = defineRepository({
  name: "Stock.repo",
  table,
  dependencies: [] as const,
  create: (binding) => new BaseRepository(binding),
});
const modelDefinition = defineModel({
  name: "Stock",
  repository: repositoryDefinition,
  dependencies: [] as const,
  attributes: {},
  construct: (state, binding) => new Stock(state, binding),
});
export async function lockContracts(database: DatabaseSession): Promise<void> {
  const bound = database.model(modelDefinition);
  const row: Stock | null = await bound.query().where({ id: 1 }).lockForUpdate().first();
  const projection: { stock: number } | null = await bound
    .query()
    .sharedLock({ wait: "nowait" })
    .select("stock")
    .first();
  void row;
  void projection;
  // @ts-expect-error Invalid wait mode cannot be admitted by typed consumers.
  bound.query().lockForUpdate({ wait: "forever" });
}

class ScopedStockRepository extends BaseRepository<{ id: number; stock: number }, "id"> {
  readonly #scope: string;

  constructor(binding: RepositoryBinding<{ id: number; stock: number }, "id">, scope: string) {
    super(binding);
    this.#scope = scope;
  }

  scope(): string {
    return this.#scope;
  }
}

const scopedDefinition = defineRepository({
  name: "scoped.stock",
  table,
  dependencies: [] as const,
  create: (binding) => new ScopedStockRepository(binding, "app-owned"),
});
/** Rebinding selects the immutable definition on the explicit child session. */
export function repositoryRebindingContract(
  database: DatabaseSession,
  child: TransactionSession,
): void {
  const repository = database.repository(scopedDefinition);
  const rebound: ScopedStockRepository = child.repository(scopedDefinition);
  const scope: string = rebound.scope();
  void scope;
  // @ts-expect-error Structural clone hooks are absent from the canonical public repository.
  repository.cloneWithConnection(child);
}
