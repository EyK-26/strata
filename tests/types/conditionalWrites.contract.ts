import { BaseRepository } from "@getstrata/core/database/baseRepository";
import { defineRepository } from "@getstrata/core/database/definitions";
import type { DatabaseSession } from "@getstrata/core/database/session";
import { defineTable } from "@getstrata/core/database/table";

const repositoryDefinition = defineRepository({
  name: "conditionalWrites",
  table: defineTable<{ id: number; stock: number; owner: string }, "id">({
    name: "stock",
    primaryKey: "id",
    columns: ["id", "stock", "owner"],
  }),
  dependencies: [] as const,
  create: (binding) => new BaseRepository(binding),
});
export async function writeContracts(database: DatabaseSession): Promise<void> {
  const repo = database.repository(repositoryDefinition);
  const count: number = await repo.query().where({ id: 1, owner: "expected" }).update({ stock: 1 });
  const rows: { stock: number }[] = await repo
    .query()
    .where({ id: 1 })
    .updateReturning({ stock: 1 }, "stock");
  void count;
  void rows;
  // @ts-expect-error Primary keys cannot be updated through conditional writes.
  repo.query().where({ id: 1 }).update({ id: 2 });
  // @ts-expect-error Values keep their declared types.
  repo.query().where({ id: 1 }).update({ stock: "bad" });
  // @ts-expect-error Projections must be declared columns.
  repo.query().where({ id: 1 }).updateReturning({ stock: 1 }, "missing");
}
