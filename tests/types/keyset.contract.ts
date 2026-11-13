import { BaseRepository } from "@getstrata/core/database/baseRepository";
import { defineRepository } from "@getstrata/core/database/definitions";
import { defineModel, Model } from "@getstrata/core/database/model";
import type { DatabaseSession } from "@getstrata/core/database/session";
import { defineTable } from "@getstrata/core/database/table";
import type { KeysetCursor } from "@getstrata/core/pagination";

const table = defineTable<
  { id: number; created_at: Date; title: string; nullable: string | null; metadata: object },
  "id"
>({
  name: "posts",
  primaryKey: "id",
  columns: ["id", "created_at", "title", "nullable", "metadata"],
});
class Post extends Model<
  { id: number; created_at: Date; title: string; nullable: string | null; metadata: object },
  "id"
> {}
const repositoryDefinition = defineRepository({
  name: "Post.repo",
  table,
  dependencies: [] as const,
  create: (binding) => new BaseRepository(binding),
});
const modelDefinition = defineModel({
  name: "Post",
  repository: repositoryDefinition,
  dependencies: [] as const,
  attributes: {},
  construct: (state, binding) => new Post(state, binding),
});
async function contracts(database: DatabaseSession) {
  const bound = database.model(modelDefinition);
  const orderBy = [
    { column: "created_at", direction: "desc" },
    { column: "id", direction: "desc" },
  ] as const;
  const page = await bound.query().select("title").keysetPaginate({ perPage: 10, orderBy });
  const cursor: KeysetCursor | null = page.meta.next_cursor;
  void cursor;
  if (page.data[0]) {
    const title: string = page.data[0].title;
    void title;
    // @ts-expect-error Selected pages do not expose unselected fields.
    page.data[0].id;
  }
  const models = await bound.keysetPaginate({ perPage: 10, orderBy });
  const model: Post | undefined = models.data[0];
  void model;
  const repo = database.repository(repositoryDefinition);
  // @ts-expect-error Nullable ordering keys are unsupported.
  repo.query().keysetPaginate({ perPage: 10, orderBy: [{ column: "nullable", direction: "asc" }] });
  bound
    .query()
    // @ts-expect-error JSON ordering keys are unsupported.
    .keysetPaginate({ perPage: 10, orderBy: [{ column: "metadata", direction: "asc" }] });
  // @ts-expect-error Unknown ordering keys are rejected.
  bound.query().keysetPaginate({ perPage: 10, orderBy: [{ column: "missing", direction: "asc" }] });
}
void contracts;
