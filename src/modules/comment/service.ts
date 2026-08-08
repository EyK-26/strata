import type { PaginatedResult } from "../../core/pagination";
import { runInTransaction } from "../../core/database";
import { NotFoundError } from "../../core/errors/http";
import TaskRepository from "../task/repository";
import CommentRepository from "./repository";
import type { CommentRecord } from "./types";

interface CreateCommentInput {
  task_id: number;
  body: string;
}

class CommentService {
  constructor(
    private readonly repository: CommentRepository,
    private readonly taskRepository: TaskRepository,
  ) {}

  paginate(options: { page: number; perPage: number }) {
    return this.repository.paginate(options);
  }

  paginateByTaskId(
    taskId: number,
    options: { page: number; perPage: number },
  ): Promise<PaginatedResult<CommentRecord>> {
    return this.repository.paginate({
      ...options,
      where: { task_id: taskId },
    });
  }

  findByIdOrThrow(id: number): Promise<CommentRecord> {
    return this.repository.findByIdOrThrow(id, (commentId) =>
      new NotFoundError(`Comment ${commentId} not found.`),
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
    return this.repository.updateByIdOrThrow(id, input, (commentId) =>
      new NotFoundError(`Comment ${commentId} not found.`),
    );
  }
}

export default CommentService;
export type { CreateCommentInput };
