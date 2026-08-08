import { currentTenantId } from "../../core/tenant/tenantContext";
import db from "../../db/connection";

interface SearchHit {
  type: "task" | "comment";
  id: number;
  snippet: string;
  rank: number;
}

class SearchService {
  async search(query: string, limit = 20): Promise<SearchHit[]> {
    const tenantId = currentTenantId();
    const rows = (await db`
      SELECT type, id, snippet, rank FROM (
        SELECT 'task'::text AS type,
               task.id,
               task.title AS snippet,
               ts_rank(task.search_vector, plainto_tsquery('english', ${query})) AS rank
        FROM task
        INNER JOIN project ON project.id = task.project_id
        INNER JOIN organization ON organization.id = project.organization_id
        WHERE task.search_vector @@ plainto_tsquery('english', ${query})
          AND organization.tenant_id = ${tenantId}
        UNION ALL
        SELECT 'comment'::text AS type,
               comment.id,
               comment.body AS snippet,
               ts_rank(comment.search_vector, plainto_tsquery('english', ${query})) AS rank
        FROM comment
        INNER JOIN task ON task.id = comment.task_id
        INNER JOIN project ON project.id = task.project_id
        INNER JOIN organization ON organization.id = project.organization_id
        WHERE comment.search_vector @@ plainto_tsquery('english', ${query})
          AND organization.tenant_id = ${tenantId}
      ) results
      WHERE rank > 0
      ORDER BY rank DESC
      LIMIT ${limit}
    `) as SearchHit[];

    return rows;
  }
}

export default SearchService;
export type { SearchHit };
