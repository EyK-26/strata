import {
  appendOrganizationScope,
  assertOrganizationReadable,
  assertResourceInCurrentTenant,
  emptyPaginateResult,
  scopedOrganizationIds,
} from "../../core/auth/membershipScope";
import { runInTransaction } from "../../core/database";
import { NotFoundError } from "../../core/errors/http";
import type { PaginatedResult } from "../../core/pagination";
import type { ProjectStatus } from "../../domain/workhub";
import { PROJECT_STATUSES } from "../../domain/workhub";
import type OrganizationRepository from "../organization/repository";
import type ProjectRepository from "./repository";
import type { ProjectRecord, ProjectWithOrganizationRecord } from "./types";

interface CreateProjectInput {
  organization_id: number;
  name: string;
  status?: ProjectStatus;
}

interface UpdateProjectInput {
  name?: string;
  status?: ProjectStatus;
}

interface ProjectListOptions {
  page: number;
  perPage: number;
  organizationId?: number;
  status?: ProjectStatus;
  includeOrganization?: boolean;
}

class ProjectService {
  constructor(
    private readonly repository: ProjectRepository,
    private readonly organizationRepository: OrganizationRepository,
  ) {}

  async paginate(
    options: ProjectListOptions,
  ): Promise<PaginatedResult<ProjectWithOrganizationRecord>> {
    const organizationIds = scopedOrganizationIds(options.organizationId);

    if (organizationIds !== null && organizationIds.length === 0) {
      return emptyPaginateResult(options.page, options.perPage);
    }

    const result = await this.repository.paginate({
      page: options.page,
      perPage: options.perPage,
      where: appendOrganizationScope(
        {
          ...(options.status === undefined ? {} : { status: options.status }),
        },
        options.organizationId,
      ),
    });

    if (!options.includeOrganization) {
      return result;
    }

    return {
      ...result,
      data: await this.repository.attachOrganizations(result.data),
    };
  }

  async findByIdOrThrow(
    id: number,
    options: { includeOrganization?: boolean } = {},
  ): Promise<ProjectWithOrganizationRecord> {
    const project = await this.repository.findByIdOrThrow(
      id,
      (projectId) => new NotFoundError(`Project ${projectId} not found.`),
    );

    const organization = await this.organizationRepository.findById(project.organization_id);

    if (!organization) {
      throw new NotFoundError(`Project ${id} not found.`);
    }

    assertResourceInCurrentTenant(organization.tenant_id, "Project", id);
    assertOrganizationReadable(project.organization_id);

    if (!options.includeOrganization) {
      return project;
    }

    const [withOrganization] = await this.repository.attachOrganizations([project]);
    return withOrganization ?? project;
  }

  create(input: CreateProjectInput): Promise<ProjectRecord> {
    const now = new Date();

    return runInTransaction(async (connection) => {
      const organizationRepository = this.organizationRepository.withConnection(connection);
      const projectRepository = this.repository.withConnection(connection);

      const organization = await organizationRepository.findById(input.organization_id);

      if (!organization) {
        throw new NotFoundError(`Organization ${input.organization_id} not found.`);
      }

      assertResourceInCurrentTenant(organization.tenant_id, "Organization", input.organization_id);
      assertOrganizationReadable(input.organization_id);

      return await projectRepository.create({
        organization_id: input.organization_id,
        name: input.name,
        status: input.status ?? "draft",
        created_at: now,
        updated_at: now,
      });
    });
  }

  async update(id: number, input: UpdateProjectInput): Promise<ProjectRecord> {
    const changes: UpdateProjectInput & { updated_at: Date } = {
      updated_at: new Date(),
    };

    if (input.name !== undefined) {
      changes.name = input.name;
    }

    if (input.status !== undefined) {
      if (!PROJECT_STATUSES.includes(input.status)) {
        throw new Error(`Invalid project status: ${input.status}`);
      }
      changes.status = input.status;
    }

    return await this.repository.updateByIdOrThrow(
      id,
      changes,
      (projectId) => new NotFoundError(`Project ${projectId} not found.`),
    );
  }

  async delete(id: number): Promise<void> {
    const deleted = await this.repository.deleteById(id);

    if (!deleted) {
      throw new NotFoundError(`Project ${id} not found.`);
    }
  }
}

export default ProjectService;
export type { CreateProjectInput, ProjectListOptions, UpdateProjectInput };
