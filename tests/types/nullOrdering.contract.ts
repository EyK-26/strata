import { BaseRepository } from "@getstrata/core/database/baseRepository";
import { defineRepository } from "@getstrata/core/database/definitions";
import { defineModel, Model } from "@getstrata/core/database/model";
import type { DatabaseSession } from "@getstrata/core/database/session";
import { defineTable } from "@getstrata/core/database/table";

const table = defineTable<{ id: number; attempted: string | null }, "id">({
  name: "receipts",
  primaryKey: "id",
  columns: ["id", "attempted"],
});
class Receipt extends Model<{ id: number; attempted: string | null }, "id"> {}
const repositoryDefinition = defineRepository({
  name: "Receipt.repo",
  table,
  dependencies: [] as const,
  create: (binding) => new BaseRepository(binding),
});
const modelDefinition = defineModel({
  name: "Receipt",
  repository: repositoryDefinition,
  dependencies: [] as const,
  attributes: {},
  construct: (state, binding) => new Receipt(state, binding),
});
export function nullOrderingContracts(database: DatabaseSession) {
  const repository = database.repository(repositoryDefinition);
  const bound = database.model(modelDefinition);
  repository
    .query()
    .orderBy([{ column: "attempted", nulls: "first" }, { column: "id" }])
    .project(["id"]);
  bound.query().orderBy({ column: "attempted", direction: "desc", nulls: "last" }).select("id");
  // @ts-expect-error Null placement is an enum, not arbitrary SQL.
  bound.query().orderBy({ column: "attempted", nulls: "FIRST; DROP TABLE receipts" });
  // @ts-expect-error Ordering remains restricted to declared columns.
  repository.query().orderBy({ column: "missing", nulls: "first" });
}
