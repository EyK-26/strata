import {
  appendProjectScope,
  assertResourceInCurrentTenant,
  emptyPaginateResult,
  scopedOrganizationIds,
} from "@getstrata/core/auth/membershipScope";
import { runInTransaction } from "@getstrata/core/database";
import { NotFoundError } from "@getstrata/core/errors/http";
import type { PaginatedResult } from "@getstrata/core/pagination";
import type OrganizationRepository from "../organization/repository";
import type ProjectRepository from "../project/repository";
import type TaskRepository from "../task/repository";
import type CommentRepository from "./repository";
import type { CommentRecord } from "./types";

export type CommentWithScope = CommentRecord & { organization_id?: number };

interface CreateCommentInput {
  task_id: number;
  body: string;
}

class CommentService {
  constructor(
    private readonly repository: CommentRepository,
    private readonly taskRepository: TaskRepository,
    private readonly projectRepository: ProjectRepository,
    private readonly organizationRepository: OrganizationRepository,
  ) {}

  async paginate(options: { page: number; perPage: number }) {
    const accessibleProjectIds = await this.resolveAccessibleProjectIds();

    if (accessibleProjectIds !== null && accessibleProjectIds.length === 0) {
      return emptyPaginateResult<CommentRecord>(options.page, options.perPage);
    }

    return this.repository.paginate({
      ...options,
      where: appendProjectScope({}, accessibleProjectIds),
    });
  }

  async paginateByTaskId(
    taskId: number,
    options: { page: number; perPage: number },
  ): Promise<PaginatedResult<CommentRecord>> {
    if (!(await this.canAccessTask(taskId))) {
      return emptyPaginateResult(options.page, options.perPage);
    }

    return this.repository.paginate({
      ...options,
      where: { task_id: taskId },
    });
  }

  async findByIdOrThrow(id: number): Promise<CommentWithScope> {
    const comment = await this.repository.findByIdOrThrow(
      id,
      (commentId) => new NotFoundError(`Comment ${commentId} not found.`),
    );

    const task = await this.taskRepository.findById(comment.task_id);

    if (!task) {
      throw new NotFoundError(`Comment ${id} not found.`);
    }

    const project = await this.projectRepository.findById(task.project_id);

    if (!project) {
      throw new NotFoundError(`Comment ${id} not found.`);
    }

    const organization = await this.organizationRepository.findById(project.organization_id);

    if (!organization) {
      throw new NotFoundError(`Comment ${id} not found.`);
    }

    assertResourceInCurrentTenant(organization.tenant_id, "Comment", id);

    if (!(await this.canAccessTask(comment.task_id, task.project_id))) {
      throw new NotFoundError(`Comment ${id} not found.`);
    }

    return {
      ...comment,
      organization_id: project.organization_id,
    };
  }

  create(input: CreateCommentInput): Promise<CommentRecord> {
    return runInTransaction(async (connection) => {
      const taskRepository = this.taskRepository.withConnection(connection);
      const commentRepository = this.repository.withConnection(connection);

      const task = await taskRepository.findById(input.task_id);

      if (!task) {
        throw new NotFoundError(`Task ${input.task_id} not found.`);
      }

      if (!(await this.canAccessTask(input.task_id, task.project_id))) {
        throw new NotFoundError(`Task ${input.task_id} not found.`);
      }

      const projectRepository = this.projectRepository.withConnection(connection);
      const organizationRepository = this.organizationRepository.withConnection(connection);
      const project = await projectRepository.findById(task.project_id);

      if (!project) {
        throw new NotFoundError(`Task ${input.task_id} not found.`);
      }

      const organization = await organizationRepository.findById(project.organization_id);

      if (!organization) {
        throw new NotFoundError(`Task ${input.task_id} not found.`);
      }

      assertResourceInCurrentTenant(organization.tenant_id, "Task", input.task_id);

      return await commentRepository.create({
        task_id: input.task_id,
        tenant_id: organization.tenant_id,
        body: input.body,
        created_at: new Date(),
      });
    });
  }

  async delete(id: number): Promise<void> {
    const deleted = await this.repository.deleteById(id);

    if (!deleted) {
      throw new NotFoundError(`Comment ${id} not found.`);
    }
  }

  update(id: number, input: { body: string }): Promise<CommentRecord> {
    return this.repository.updateByIdOrThrow(
      id,
      input,
      (commentId) => new NotFoundError(`Comment ${commentId} not found.`),
    );
  }

  private async resolveAccessibleProjectIds(): Promise<number[] | null> {
    const organizationIds = scopedOrganizationIds();

    if (organizationIds === null) {
      return null;
    }

    if (organizationIds.length === 0) {
      return [];
    }

    return this.projectRepository.findIdsByOrganizationIds(organizationIds);
  }

  private async canAccessTask(taskId: number, projectIdHint?: number): Promise<boolean> {
    const organizationIds = scopedOrganizationIds();

    if (organizationIds === null) {
      return true;
    }

    if (organizationIds.length === 0) {
      return false;
    }

    const task =
      projectIdHint === undefined
        ? await this.taskRepository.findById(taskId)
        : { project_id: projectIdHint };

    if (!task) {
      return false;
    }

    const project = await this.projectRepository.findById(task.project_id);

    return project ? organizationIds.includes(project.organization_id) : false;
  }
}

export default CommentService;
export type { CreateCommentInput };
