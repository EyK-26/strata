import { currentTenantId } from "@getstrata/core/tenant/tenantContext";
import type CommentRepository from "../comment/repository";
import type OrganizationRepository from "../organization/repository";
import type ProjectRepository from "../project/repository";
import type TaskRepository from "../task/repository";

interface SearchHit {
  type: "organization" | "project" | "task" | "comment";
  id: number;
  snippet: string;
  rank: number;
}

class SearchService {
  constructor(
    private readonly taskRepository: TaskRepository,
    private readonly commentRepository: CommentRepository,
    private readonly organizationRepository: OrganizationRepository,
    private readonly projectRepository: ProjectRepository,
  ) {}

  async search(query: string, limit = 20): Promise<SearchHit[]> {
    const tenantId = currentTenantId();
    const [tasks, comments, organizations, projects] = await Promise.all([
      this.taskRepository.searchFullText(query, tenantId, limit),
      this.commentRepository.searchFullText(query, tenantId, limit),
      this.searchOrganizations(query, tenantId, limit),
      this.searchProjects(query, tenantId, limit),
    ]);

    return [...organizations, ...projects, ...tasks, ...comments]
      .filter((hit) => Number(hit.rank) > 0)
      .sort((left, right) => Number(right.rank) - Number(left.rank))
      .slice(0, limit);
  }

  private async searchOrganizations(
    query: string,
    tenantId: number,
    limit: number,
  ): Promise<SearchHit[]> {
    const organizations = await this.organizationRepository
      .query({ tenant_id: tenantId })
      .where((builder) => {
        builder.whereGroup((group) => {
          group.where({ name: { ilike: query } }).orWhere({ slug: { ilike: query } });
        });
      })
      .limit(limit)
      .get();

    return organizations.map((organization) => ({
      type: "organization" as const,
      id: organization.id,
      snippet: organization.name,
      rank: 0.6,
    }));
  }

  private async searchProjects(
    query: string,
    tenantId: number,
    limit: number,
  ): Promise<SearchHit[]> {
    const projects = await this.projectRepository.findAll({
      where: { tenant_id: tenantId, name: { ilike: query } },
      limit,
    });

    return projects.map((project) => ({
      type: "project" as const,
      id: project.id,
      snippet: project.name,
      rank: 0.55,
    }));
  }
}

export default SearchService;
export type { SearchHit };
