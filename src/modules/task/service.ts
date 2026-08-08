import type { PaginatedResult } from "../../core/pagination";
import { TASK_STATUSES } from "../../domain/workhub";
import { runInTransaction } from "../../core/database";
import { BadRequestError, NotFoundError } from "../../core/errors/http";
import ProjectRepository from "../project/repository";
import TaskRepository from "./repository";
import type { TaskRecord, TaskWithProjectRecord } from "./types";
import type { TaskStatus } from "../../domain/workhub";

interface CreateTaskInput {
  project_id: number;
  title: string;
  status?: TaskStatus;
  priority?: number;
}

interface UpdateTaskInput {
  title?: string;
  status?: TaskStatus;
  priority?: number;
}

interface TaskListOptions {
  page: number;
  perPage: number;
  projectId?: number;
  status?: TaskStatus;
  includeProject?: boolean;
}

class TaskService {
  constructor(
    private readonly repository: TaskRepository,
    private readonly projectRepository: ProjectRepository,
  ) {}

  async paginate(
    options: TaskListOptions,
  ): Promise<PaginatedResult<TaskWithProjectRecord>> {
    const result = await this.repository.paginate({
      page: options.page,
      perPage: options.perPage,
      where: {
        ...(options.projectId === undefined
          ? {}
          : { project_id: options.projectId }),
        ...(options.status === undefined ? {} : { status: options.status }),
      },
    });

    if (!options.includeProject) {
      return result;
    }

    return {
      ...result,
      data: await this.repository.attachProjects(result.data),
    };
  }

  async findByIdOrThrow(
    id: number,
    options: { includeProject?: boolean } = {},
  ): Promise<TaskWithProjectRecord> {
    const task = await this.repository.findByIdOrThrow(id, (taskId) =>
      new NotFoundError(`Task ${taskId} not found.`),
    );

    if (!options.includeProject) {
      return task;
    }

    const [withProject] = await this.repository.attachProjects([task]);
    return withProject ?? task;
  }

  create(input: CreateTaskInput): Promise<TaskRecord> {
    const now = new Date();
    const priority = input.priority ?? 0;

    if (priority < 0 || priority > 5) {
      throw new BadRequestError("Task priority must be between 0 and 5.");
    }

    return runInTransaction(async (connection) => {
      const projectRepository =
        this.projectRepository.withConnection(connection);
      const taskRepository = this.repository.withConnection(connection);

      const project = await projectRepository.findById(input.project_id);

      if (!project) {
        throw new NotFoundError(`Project ${input.project_id} not found.`);
      }

      return await taskRepository.create({
        project_id: input.project_id,
        title: input.title,
        status: input.status ?? "todo",
        priority,
        created_at: now,
        updated_at: now,
      });
    });
  }

  async update(id: number, input: UpdateTaskInput): Promise<TaskRecord> {
    const changes: UpdateTaskInput & { updated_at: Date } = {
      updated_at: new Date(),
    };

    if (input.title !== undefined) {
      changes.title = input.title;
    }

    if (input.status !== undefined) {
      if (!TASK_STATUSES.includes(input.status)) {
        throw new BadRequestError(`Invalid task status: ${input.status}`);
      }
      changes.status = input.status;
    }

    if (input.priority !== undefined) {
      if (input.priority < 0 || input.priority > 5) {
        throw new BadRequestError("Task priority must be between 0 and 5.");
      }
      changes.priority = input.priority;
    }

    return await this.repository.updateByIdOrThrow(id, changes, (taskId) =>
      new NotFoundError(`Task ${taskId} not found.`),
    );
  }

  async delete(id: number): Promise<void> {
    const deleted = await this.repository.deleteById(id);

    if (!deleted) {
      throw new NotFoundError(`Task ${id} not found.`);
    }
  }
}

export default TaskService;
export type { CreateTaskInput, TaskListOptions, UpdateTaskInput };
