import { PROJECT_STATUSES } from "../../domain/workhub";
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
import type { ProjectStatus } from "../../domain/workhub";

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

function parseProjectIdParams(params: ProjectIdParams): { id: number } {
  return {
    id: parsePositiveIntParam(params.id, "project id"),
  };
}

function parseProjectListQuery(request?: Request): ProjectListQueryDto {
  const params = getQueryParams(request);
  const include = params.get("include");
  const pagination = parsePaginationQuery(request);

  if (include !== null && include !== "" && include !== "organization") {
    throw new BadRequestError(
      'Invalid query parameter "include". Expected "organization".',
    );
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

async function parseCreateProjectBody(
  request: Request,
): Promise<CreateProjectBodyDto> {
  return await parseJsonBody(request, (payload) => {
    const body = expectObject(payload);

    return {
      organization_id: readRequiredPositiveInt(body, "organization_id"),
      name: readRequiredString(body, "name", { minLength: 1, maxLength: 120 }),
      status: readOptionalEnum(body, "status", PROJECT_STATUSES),
    };
  });
}

async function parseUpdateProjectBody(
  request: Request,
): Promise<UpdateProjectBodyDto> {
  return await parseJsonBody(request, (payload) => {
    const body = expectObject(payload);
    const name = readOptionalString(body, "name", {
      minLength: 1,
      maxLength: 120,
    });
    const status = readOptionalEnum(body, "status", PROJECT_STATUSES);

    if (name === undefined && status === undefined) {
      throw new BadRequestError(
        'At least one of "name" or "status" must be provided.',
      );
    }

    return {
      ...(name === undefined ? {} : { name }),
      ...(status === undefined ? {} : { status }),
    };
  });
}

export {
  parseCreateProjectBody,
  parseProjectIdParams,
  parseProjectListQuery,
  parseUpdateProjectBody,
};
export type {
  CreateProjectBodyDto,
  ProjectIdParams,
  ProjectListQueryDto,
  UpdateProjectBodyDto,
};
