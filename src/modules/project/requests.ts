import { BadRequestError } from "@getstrata/core/errors/http";
import { FormRequest, QueryFormRequest } from "@getstrata/core/http/formRequest";
import { parsePaginationQuery } from "@getstrata/core/http/pagination";
import {
  getQueryParams,
  parseOptionalEnumQueryParam,
  parsePositiveIntParam,
} from "@getstrata/core/http/validation";
import {
  enumRule,
  maxLength,
  minLength,
  optional,
  positiveIntegerRule,
  required,
  stringRule,
  validateObject,
} from "@getstrata/core/validation/rules";
import type { ProjectStatus } from "../../domain/workhub";
import { PROJECT_STATUSES } from "../../domain/workhub";

type ProjectIdParams = { id: string };

interface ProjectListQueryDto {
  page: number;
  perPage: number;
  organizationId?: number;
  status?: ProjectStatus;
  include?: "organization";
}

interface CreateProjectBodyDto {
  organization_id: number;
  name: string;
  status?: ProjectStatus;
}

interface UpdateProjectBodyDto {
  name?: string;
  status?: ProjectStatus;
}

class ProjectListQueryRequest extends QueryFormRequest<ProjectListQueryDto> {
  protected parseQuery(request?: Request): ProjectListQueryDto {
    const params = getQueryParams(request);
    const include = params.get("include");
    const pagination = parsePaginationQuery(request);

    if (include !== null && include !== "" && include !== "organization") {
      throw new BadRequestError('Invalid query parameter "include". Expected "organization".');
    }

    const organizationIdRaw = params.get("organizationId");
    let organizationId: number | undefined;

    if (organizationIdRaw !== null && organizationIdRaw !== "") {
      organizationId = parsePositiveIntParam(organizationIdRaw, "organizationId");
    }

    return {
      ...pagination,
      organizationId,
      status: parseOptionalEnumQueryParam(params, "status", PROJECT_STATUSES),
      ...(include === "organization" ? { include: "organization" as const } : {}),
    };
  }
}

class CreateProjectRequest extends FormRequest<CreateProjectBodyDto> {
  protected parse(payload: unknown): CreateProjectBodyDto {
    const validated = validateObject(payload, {
      organization_id: [required(), positiveIntegerRule()],
      name: [required(), stringRule(), minLength(1), maxLength(120)],
      status: [optional(), enumRule(PROJECT_STATUSES)],
    });

    return {
      organization_id: validated.organization_id as number,
      name: validated.name as string,
      ...(validated.status === undefined ? {} : { status: validated.status as ProjectStatus }),
    };
  }
}

class UpdateProjectRequest extends FormRequest<UpdateProjectBodyDto> {
  protected parse(payload: unknown): UpdateProjectBodyDto {
    if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
      throw new BadRequestError("Request body must be a JSON object.");
    }

    const body = payload as Record<string, unknown>;
    const changes: UpdateProjectBodyDto = {};

    if ("name" in body && body.name !== undefined) {
      const validated = validateObject(body, {
        name: [required(), stringRule(), minLength(1), maxLength(120)],
      }) as { name: string };
      changes.name = validated.name;
    }

    if ("status" in body && body.status !== undefined) {
      const validated = validateObject(body, {
        status: [required(), enumRule(PROJECT_STATUSES)],
      }) as { status: ProjectStatus };
      changes.status = validated.status;
    }

    if (changes.name === undefined && changes.status === undefined) {
      throw new BadRequestError('At least one of "name" or "status" must be provided.');
    }

    return changes;
  }
}

const projectListQueryRequest = new ProjectListQueryRequest();
const createProjectRequest = new CreateProjectRequest();
const updateProjectRequest = new UpdateProjectRequest();

function parseProjectIdParams(params: ProjectIdParams): { id: number } {
  return {
    id: parsePositiveIntParam(params.id, "project id"),
  };
}

function parseProjectListQuery(request?: Request): ProjectListQueryDto {
  return projectListQueryRequest.validate(request);
}

async function parseCreateProjectBody(request: Request): Promise<CreateProjectBodyDto> {
  return await createProjectRequest.validate(request);
}

async function parseUpdateProjectBody(request: Request): Promise<UpdateProjectBodyDto> {
  return await updateProjectRequest.validate(request);
}

export type { CreateProjectBodyDto, ProjectIdParams, ProjectListQueryDto, UpdateProjectBodyDto };
export {
  CreateProjectRequest,
  ProjectListQueryRequest,
  parseCreateProjectBody,
  parseProjectIdParams,
  parseProjectListQuery,
  parseUpdateProjectBody,
  UpdateProjectRequest,
};
