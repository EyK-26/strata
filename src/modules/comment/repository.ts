import { BaseRepository } from "@getstrata/core/database";
import type { QueryWhere } from "@getstrata/core/database/types";
import { commentTable } from "./table";
import type { CommentRecord } from "./types";

interface CommentSearchHit {
  type: "comment";
  id: number;
  snippet: string;
  rank: number;
}

class CommentRepository extends BaseRepository<CommentRecord, "id"> {
  constructor() {
    super(commentTable);
  }

  async searchFullText(
    query: string,
    tenantId: number,
    limit: number,
  ): Promise<CommentSearchHit[]> {
    const rows = await this.findAll({
      joins: [
        {
          type: "inner",
          table: "task",
          on: [
            {
              left: { table: "comment", column: "task_id" },
              right: { table: "task", column: "id" },
            },
          ],
        },
        {
          type: "inner",
          table: "project",
          on: [
            {
              left: { table: "task", column: "project_id" },
              right: { table: "project", column: "id" },
            },
          ],
        },
        {
          type: "inner",
          table: "organization",
          on: [
            {
              left: { table: "project", column: "organization_id" },
              right: { table: "organization", column: "id" },
            },
          ],
        },
      ],
      where: {
        "organization.tenant_id": tenantId,
        search_vector: { tsMatch: query },
      } as QueryWhere<CommentRecord>,
      select: [
        { kind: "literalText", value: "comment", as: "type" },
        { kind: "column", table: "comment", column: "id", as: "id" },
        { kind: "column", table: "comment", column: "body", as: "snippet" },
        { kind: "tsRank", table: "comment", column: "search_vector", query, as: "rank" },
      ],
      limit,
    });

    return rows as unknown as CommentSearchHit[];
  }

  async findByTaskId(taskId: number): Promise<CommentRecord[]> {
    return await this.findWhere({ task_id: taskId });
  }
}

export default CommentRepository;
export type { CommentSearchHit };
