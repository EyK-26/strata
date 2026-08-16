import { BaseRepository } from "@getstrata/core/database/baseRepository";
import type { QueryWhere } from "@getstrata/core/database/types";
import OrganizationRepository from "../organization/repository";
import { projectBelongsToOrganization } from "./relationships";
import { projectTable } from "./table";
import type { ProjectRecord, ProjectWithOrganizationRecord } from "./types";

class ProjectRepository extends BaseRepository<ProjectRecord, "id"> {
  constructor(
    private readonly organizationRepository: OrganizationRepository = new OrganizationRepository(),
  ) {
    super(projectTable);
  }

  async attachOrganizations(
    projects: readonly ProjectRecord[],
  ): Promise<ProjectWithOrganizationRecord[]> {
    if (projects.length === 0) {
      return [];
    }

    const organizationsById = await this.loadBelongsToForParents(
      projects,
      projectBelongsToOrganization,
      this.organizationRepository,
    );

    return projects.map((project) => {
      const organization = organizationsById.get(project.organization_id);

      return {
        ...project,
        ...(organization
          ? {
              organization: {
                id: organization.id,
                name: organization.name,
                slug: organization.slug,
              },
            }
          : {}),
      };
    });
  }

  async findIdsByOrganizationIds(organizationIds: number | number[]): Promise<number[]> {
    const records = await this.findWhere({
      organization_id: organizationIds,
    } as QueryWhere<ProjectRecord>);

    return records.map((project) => project.id);
  }
}

export default ProjectRepository;
