import { BaseRepository } from "@getstrata/core/database/baseRepository";
import { defineModel } from "@getstrata/core/database/model";
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
class Post extends defineModel(table) {}
async function contracts() {
  const orderBy = [
    { column: "created_at", direction: "desc" },
    { column: "id", direction: "desc" },
  ] as const;
  const page = await Post.query().select("title").keysetPaginate({ perPage: 10, orderBy });
  const cursor: KeysetCursor | null = page.meta.next_cursor;
  void cursor;
  if (page.data[0]) {
    const title: string = page.data[0].title;
    void title;
    // @ts-expect-error Selected pages do not expose unselected fields.
    page.data[0].id;
  }
  const models = await Post.keysetPaginate({ perPage: 10, orderBy });
  const model: Post | undefined = models.data[0];
  void model;
  const repo = new BaseRepository(table);
  // @ts-expect-error Nullable ordering keys are unsupported.
  repo.query().keysetPaginate({ perPage: 10, orderBy: [{ column: "nullable", direction: "asc" }] });
  // @ts-expect-error JSON ordering keys are unsupported.
  Post.query().keysetPaginate({ perPage: 10, orderBy: [{ column: "metadata", direction: "asc" }] });
  // @ts-expect-error Unknown ordering keys are rejected.
  Post.query().keysetPaginate({ perPage: 10, orderBy: [{ column: "missing", direction: "asc" }] });
}
void contracts;
