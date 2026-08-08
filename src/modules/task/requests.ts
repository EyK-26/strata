import { TASK_STATUSES } from "../../domain/workhub";
import {
  BadRequestError,
  expectObject,
  getQueryParams,
  parseJsonBody,
  parseOptionalEnumQueryParam,
  parsePaginationQuery,
  parsePositiveIntParam,
  readOptionalEnum,
  readOptionalString,
  readRequiredPositiveInt,
  readRequiredString,
} from "../../core/http";

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

function parseTaskIdParams(params: TaskIdParams): { id: number } {
  return {
    id: parsePositiveIntParam(params.id, "task id"),
  };
}

function parseTaskListQuery(request?: Request): TaskListQueryDto {
  const params = getQueryParams(request);
  const include = params.get("include");
  const pagination = parsePaginationQuery(request);

  if (include !== null && include !== "" && include !== "project") {
    throw new BadRequestError(
      'Invalid query parameter "include". Expected "project".',
    );
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

async function parseCreateTaskBody(
  request: Request,
): Promise<CreateTaskBodyDto> {
  return await parseJsonBody(request, (payload) => {
    const body = expectObject(payload);
    const priorityRaw = body.priority;

    let priority: number | undefined;

    if (priorityRaw !== undefined) {
      if (
        typeof priorityRaw !== "number" ||
        !Number.isInteger(priorityRaw) ||
        priorityRaw < 0 ||
        priorityRaw > 5
      ) {
        throw new BadRequestError(
          '"priority" must be an integer between 0 and 5.',
        );
      }

      priority = priorityRaw;
    }

    return {
      project_id: readRequiredPositiveInt(body, "project_id"),
      title: readRequiredString(body, "title", { minLength: 1, maxLength: 200 }),
      status: readOptionalEnum(body, "status", TASK_STATUSES),
      ...(priority === undefined ? {} : { priority }),
    };
  });
}

async function parseUpdateTaskBody(request: Request): Promise<UpdateTaskBodyDto> {
  return await parseJsonBody(request, (payload) => {
    const body = expectObject(payload);
    const title = readOptionalString(body, "title", {
      minLength: 1,
      maxLength: 200,
    });
    const status = readOptionalEnum(body, "status", TASK_STATUSES);
    const priorityRaw = body.priority;

    let priority: number | undefined;

    if (priorityRaw !== undefined) {
      if (
        typeof priorityRaw !== "number" ||
        !Number.isInteger(priorityRaw) ||
        priorityRaw < 0 ||
        priorityRaw > 5
      ) {
        throw new BadRequestError(
          '"priority" must be an integer between 0 and 5.',
        );
      }

      priority = priorityRaw;
    }

    if (title === undefined && status === undefined && priority === undefined) {
      throw new BadRequestError(
        'At least one of "title", "status", or "priority" must be provided.',
      );
    }

    return {
      ...(title === undefined ? {} : { title }),
      ...(status === undefined ? {} : { status }),
      ...(priority === undefined ? {} : { priority }),
    };
  });
}

export {
  parseCreateTaskBody,
  parseTaskIdParams,
  parseTaskListQuery,
  parseUpdateTaskBody,
};
export type {
  CreateTaskBodyDto,
  TaskIdParams,
  TaskListQueryDto,
  UpdateTaskBodyDto,
};
