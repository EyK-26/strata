import {
  appendProjectScope,
  emptyPaginateResult,
  scopedOrganizationIds,
} from "../../core/auth/membershipScope";
import { runInTransaction } from "../../core/database";
import { NotFoundError } from "../../core/errors/http";
import type { PaginatedResult } from "../../core/pagination";
import type ProjectRepository from "../project/repository";
import type TaskRepository from "../task/repository";
import type CommentRepository from "./repository";
import type { CommentRecord } from "./types";

interface CreateCommentInput {
  task_id: number;
  body: string;
}

class CommentService {
  constructor(
    private readonly repository: CommentRepository,
    private readonly taskRepository: TaskRepository,
    private readonly projectRepository: ProjectRepository,
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

  findByIdOrThrow(id: number): Promise<CommentRecord> {
    return this.repository.findByIdOrThrow(
      id,
      (commentId) => new NotFoundError(`Comment ${commentId} not found.`),
    );
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

      return await commentRepository.create({
        task_id: input.task_id,
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
