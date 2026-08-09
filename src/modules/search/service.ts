import { currentTenantId } from "@getstrata/core/tenant/tenantContext";
import type CommentRepository from "../comment/repository";
import type TaskRepository from "../task/repository";

interface SearchHit {
  type: "task" | "comment";
  id: number;
  snippet: string;
  rank: number;
}

class SearchService {
  constructor(
    private readonly taskRepository: TaskRepository,
    private readonly commentRepository: CommentRepository,
  ) {}

  async search(query: string, limit = 20): Promise<SearchHit[]> {
    const tenantId = currentTenantId();
    const [tasks, comments] = await Promise.all([
      this.taskRepository.searchFullText(query, tenantId, limit),
      this.commentRepository.searchFullText(query, tenantId, limit),
    ]);

    return [...tasks, ...comments]
      .filter((hit) => Number(hit.rank) > 0)
      .sort((left, right) => Number(right.rank) - Number(left.rank))
      .slice(0, limit);
  }
}

export default SearchService;
export type { SearchHit };
