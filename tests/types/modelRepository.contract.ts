/** Positive installed repository contracts; no database or top-level writes. */
import type { AfterCommitRepositoryContext as RootAfterCommitContext } from "@getstrata/core";
import type { ExecutionContext } from "@getstrata/core/contracts/application";
import type { ExecutionPersistence } from "@getstrata/core/contracts/persistence";
import { BaseRepository } from "@getstrata/core/database/baseRepository";
import type {
  AfterCommitRepositoryContext,
  AfterCommitRepositoryListener,
} from "@getstrata/core/database/definitions";
import { defineModel, defineRepository } from "@getstrata/core/database/definitions";
import { Model } from "@getstrata/core/database/model";
import type { DatabaseSession } from "@getstrata/core/database/session";
import { defineTable } from "@getstrata/core/database/table";
export interface LeadRecord {
  id: string;
  email: string;
  attempts: number;
}
interface StockRecord {
  sku: string;
  quantity: number;
}
export class LeadEntity extends Model<LeadRecord, "id"> {}
class ChildLeadEntity extends LeadEntity {}
class StockEntity extends Model<StockRecord, "sku"> {}
export const LeadRepository = defineRepository({
  name: "LeadRepository",
  table: defineTable<LeadRecord, "id">({
    name: "leads",
    primaryKey: "id",
    columns: ["id", "email", "attempts"],
  }),
  dependencies: [],
  create: (binding) => new BaseRepository(binding),
});
export const StockRepository = defineRepository({
  name: "StockRepository",
  table: defineTable<StockRecord, "sku">({
    name: "stock",
    primaryKey: "sku",
    columns: ["sku", "quantity"],
  }),
  dependencies: [],
  create: (binding) => new BaseRepository(binding),
});
export const Lead = defineModel({
  name: "Lead",
  repository: LeadRepository,
  dependencies: [],
  attributes: {},
  construct: (state, binding) => new LeadEntity(state, binding),
});
const ChildLead = defineModel({
  name: "ChildLead",
  repository: LeadRepository,
  dependencies: [],
  attributes: {},
  construct: (state, binding) => new ChildLeadEntity(state, binding),
});
export const Stock = defineModel({
  name: "Stock",
  repository: StockRepository,
  dependencies: [],
  attributes: {},
  construct: (state, binding) => new StockEntity(state, binding),
});
export async function validRepositoryContracts(database: DatabaseSession) {
  const inferred = database.repository(LeadRepository);
  const checked: BaseRepository<LeadRecord, "id"> = inferred;
  void checked;
  const explicit: BaseRepository<LeadRecord, "id"> = database.repository<
    LeadRecord,
    "id",
    BaseRepository<LeadRecord, "id">
  >(LeadRepository);
  const inherited = database.model(ChildLead).repository();
  for (const repository of [inferred, explicit, inherited, database.model(Lead).repository()]) {
    const result = await repository.upsert(
      { id: "fixture", email: "fixture@example.test", attempts: 0 },
      ["email"],
      ["email"],
    );
    if (result) {
      const row: LeadRecord = result;
      const email: string = row.email;
      void email;
    }
    const found = await repository.findById("fixture");
    if (found) {
      const id: string = found.id;
      void id;
    }
  }
  const stock = database.repository(StockRepository);
  const key: "sku" = stock.getTable().primaryKey;
  const result = await stock.upsert({ sku: "fixture", quantity: 0 }, ["sku"], ["quantity"]);
  if (result) {
    const sku: string = result.sku;
    const quantity: number = result.quantity;
    void sku;
    void quantity;
  }
  void key;
}

/** This copied installed contract verifies root and definitions context exports. */
export function afterCommitContextContract(context: AfterCommitRepositoryContext) {
  const root: RootAfterCommitContext = context;
  const definitions: AfterCommitRepositoryContext = root;
  const persistence: ExecutionPersistence = definitions;
  const execution: ExecutionContext = context.execution;
  const databaseOnly: (
    row: Readonly<LeadRecord>,
    context: Readonly<{ database: DatabaseSession }>,
  ) => void = () => {};
  const listener: AfterCommitRepositoryListener<LeadRecord> = databaseOnly;
  const contextual: AfterCommitRepositoryListener<LeadRecord> = async (_row, supplied) => {
    const snapshot: ExecutionContext = supplied.execution;
    if (typeof snapshot.tenant?.id === "number") {
      await supplied.policy.run(
        supplied.database,
        { kind: "tenant", tenantId: snapshot.tenant.id },
        async (selected) => {
          await selected.execute({ text: "SELECT 1", params: [] });
        },
      );
    }
  };
  // @ts-expect-error Publication context root is readonly.
  context.database = persistence.database;
  // @ts-expect-error Publication policy is readonly.
  context.policy = persistence.policy;
  // @ts-expect-error Publishing execution cannot be replaced.
  context.execution = execution;
  // @ts-expect-error Execution identity is immutable.
  context.execution.executionId = "replacement";
  // @ts-expect-error Established tenant snapshot is immutable.
  if (context.execution.tenant) context.execution.tenant.id = 2;
  // @ts-expect-error Execution principal is immutable.
  context.execution.actor = { kind: "system", policy: "replacement" };
  // @ts-expect-error Principals retain readonly claims.
  if (context.execution.actor?.kind === "principal") context.execution.actor.claims.id = 2;
  // @ts-expect-error Publication database remains a root facade, not a transaction.
  context.database.requestRollback();
  // @ts-expect-error Existing execution ownership is not exposed to application listeners.
  context.ownership;
  void listener;
  void contextual;
}
