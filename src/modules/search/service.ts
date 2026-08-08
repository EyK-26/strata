import db from "../../db/connection";

interface SearchHit {
  type: "task" | "comment";
  id: number;
  snippet: string;
  rank: number;
}

class SearchService {
  async search(query: string, limit = 20): Promise<SearchHit[]> {
    const rows = (await db`
      SELECT type, id, snippet, rank FROM (
        SELECT 'task'::text AS type,
               id,
               title AS snippet,
               ts_rank(search_vector, plainto_tsquery('english', ${query})) AS rank
        FROM task
        WHERE search_vector @@ plainto_tsquery('english', ${query})
        UNION ALL
        SELECT 'comment'::text AS type,
               id,
               body AS snippet,
               ts_rank(search_vector, plainto_tsquery('english', ${query})) AS rank
        FROM comment
        WHERE search_vector @@ plainto_tsquery('english', ${query})
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
