import {
  BadRequestError,
  FormRequest,
  getQueryParams,
  parseOptionalEnumQueryParam,
  parsePaginationQuery,
  parsePositiveIntParam,
  QueryFormRequest,
} from "../../core/http";
import {
  enumRule,
  integerRange,
  maxLength,
  minLength,
  optional,
  positiveIntegerRule,
  required,
  stringRule,
  validateObject,
} from "../../core/validation/rules";
import { TASK_STATUSES } from "../../domain/workhub";

type TaskIdParams = { id: string };

interface TaskListQueryDto {
  page: number;
  perPage: number;
  projectId?: number;
  status?: (typeof TASK_STATUSES)[number];
  include?: "project";
}

interface CreateTaskBodyDto {
  project_id: number;
  title: string;
  status?: (typeof TASK_STATUSES)[number];
  priority?: number;
}

interface UpdateTaskBodyDto {
  title?: string;
  status?: (typeof TASK_STATUSES)[number];
  priority?: number;
}

class TaskListQueryRequest extends QueryFormRequest<TaskListQueryDto> {
  protected parseQuery(request?: Request): TaskListQueryDto {
    const params = getQueryParams(request);
    const include = params.get("include");
    const pagination = parsePaginationQuery(request);

    if (include !== null && include !== "" && include !== "project") {
      throw new BadRequestError('Invalid query parameter "include". Expected "project".');
    }

    const projectIdRaw = params.get("projectId");
    let projectId: number | undefined;

    if (projectIdRaw !== null && projectIdRaw !== "") {
      projectId = parsePositiveIntParam(projectIdRaw, "projectId");
    }

    return {
      ...pagination,
      projectId,
      status: parseOptionalEnumQueryParam(params, "status", TASK_STATUSES),
      ...(include === "project" ? { include: "project" as const } : {}),
    };
  }
}

class CreateTaskRequest extends FormRequest<CreateTaskBodyDto> {
  protected parse(payload: unknown): CreateTaskBodyDto {
    const validated = validateObject(payload, {
      project_id: [required(), positiveIntegerRule()],
      title: [required(), stringRule(), minLength(1), maxLength(200)],
      status: [optional(), enumRule(TASK_STATUSES)],
      priority: [optional(), integerRange(0, 5)],
    });

    return {
      project_id: validated.project_id as number,
      title: validated.title as string,
      ...(validated.status === undefined
        ? {}
        : { status: validated.status as (typeof TASK_STATUSES)[number] }),
      ...(validated.priority === undefined ? {} : { priority: validated.priority as number }),
    };
  }
}

class UpdateTaskRequest extends FormRequest<UpdateTaskBodyDto> {
  protected parse(payload: unknown): UpdateTaskBodyDto {
    if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
      throw new BadRequestError("Request body must be a JSON object.");
    }

    const body = payload as Record<string, unknown>;
    const changes: UpdateTaskBodyDto = {};

    if ("title" in body && body.title !== undefined) {
      const validated = validateObject(body, {
        title: [required(), stringRule(), minLength(1), maxLength(200)],
      }) as { title: string };
      changes.title = validated.title;
    }

    if ("status" in body && body.status !== undefined) {
      const validated = validateObject(body, {
        status: [required(), enumRule(TASK_STATUSES)],
      }) as { status: (typeof TASK_STATUSES)[number] };
      changes.status = validated.status;
    }

    if ("priority" in body && body.priority !== undefined) {
      const validated = validateObject(body, {
        priority: [required(), integerRange(0, 5)],
      }) as { priority: number };
      changes.priority = validated.priority;
    }

    if (
      changes.title === undefined &&
      changes.status === undefined &&
      changes.priority === undefined
    ) {
      throw new BadRequestError(
        'At least one of "title", "status", or "priority" must be provided.',
      );
    }

    return changes;
  }
}

const taskListQueryRequest = new TaskListQueryRequest();
const createTaskRequest = new CreateTaskRequest();
const updateTaskRequest = new UpdateTaskRequest();

function parseTaskIdParams(params: TaskIdParams): { id: number } {
  return {
    id: parsePositiveIntParam(params.id, "task id"),
  };
}

function parseTaskListQuery(request?: Request): TaskListQueryDto {
  return taskListQueryRequest.validate(request);
}

async function parseCreateTaskBody(request: Request): Promise<CreateTaskBodyDto> {
  return await createTaskRequest.validate(request);
}

async function parseUpdateTaskBody(request: Request): Promise<UpdateTaskBodyDto> {
  return await updateTaskRequest.validate(request);
}

export type { CreateTaskBodyDto, TaskIdParams, TaskListQueryDto, UpdateTaskBodyDto };
export {
  CreateTaskRequest,
  parseCreateTaskBody,
  parseTaskIdParams,
  parseTaskListQuery,
  parseUpdateTaskBody,
  TaskListQueryRequest,
  UpdateTaskRequest,
};
