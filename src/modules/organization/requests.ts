import { BadRequestError } from "@getstrata/core/errors/http";
import { FormRequest, QueryFormRequest } from "@getstrata/core/http/formRequest";
import { parsePaginationQuery } from "@getstrata/core/http/pagination";
import { parsePositiveIntParam } from "@getstrata/core/http/validation";
import {
  maxLength,
  minLength,
  pattern,
  required,
  stringRule,
  validateObject,
} from "@getstrata/core/validation/rules";

type OrganizationIdParams = { id: string };

interface OrganizationListQueryDto {
  page: number;
  perPage: number;
}

interface CreateOrganizationBodyDto {
  name: string;
  slug: string;
}

interface UpdateOrganizationBodyDto {
  name?: string;
  slug?: string;
}

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const createOrganizationRules = {
  name: [required(), stringRule(), minLength(1), maxLength(120)],
  slug: [required(), stringRule(), minLength(2), maxLength(64), pattern(SLUG_PATTERN)],
};

class OrganizationListQueryRequest extends QueryFormRequest<OrganizationListQueryDto> {
  protected parseQuery(request?: Request): OrganizationListQueryDto {
    return parsePaginationQuery(request);
  }
}

class CreateOrganizationRequest extends FormRequest<CreateOrganizationBodyDto> {
  protected parse(payload: unknown): CreateOrganizationBodyDto {
    const validated = validateObject(payload, createOrganizationRules);

    return {
      name: validated.name as string,
      slug: (validated.slug as string).toLowerCase(),
    };
  }
}

class UpdateOrganizationRequest extends FormRequest<UpdateOrganizationBodyDto> {
  protected parse(payload: unknown): UpdateOrganizationBodyDto {
    if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
      throw new BadRequestError("Request body must be a JSON object.");
    }

    const body = payload as Record<string, unknown>;
    const changes: UpdateOrganizationBodyDto = {};

    if ("name" in body && body.name !== undefined) {
      const validated = validateObject(body, {
        name: [required(), stringRule(), minLength(1), maxLength(120)],
      }) as { name: string };
      changes.name = validated.name;
    }

    if ("slug" in body && body.slug !== undefined) {
      const validated = validateObject(body, {
        slug: [required(), stringRule(), minLength(2), maxLength(64), pattern(SLUG_PATTERN)],
      }) as { slug: string };
      changes.slug = validated.slug.toLowerCase();
    }

    if (changes.name === undefined && changes.slug === undefined) {
      throw new BadRequestError('At least one of "name" or "slug" must be provided.');
    }

    return changes;
  }
}

const organizationListQueryRequest = new OrganizationListQueryRequest();
const createOrganizationRequest = new CreateOrganizationRequest();
const updateOrganizationRequest = new UpdateOrganizationRequest();

function parseOrganizationIdParams(params: OrganizationIdParams): { id: number } {
  return {
    id: parsePositiveIntParam(params.id, "organization id"),
  };
}

function parseOrganizationListQuery(request?: Request): OrganizationListQueryDto {
  return organizationListQueryRequest.validate(request);
}

async function parseCreateOrganizationBody(request: Request): Promise<CreateOrganizationBodyDto> {
  return await createOrganizationRequest.validate(request);
}

async function parseUpdateOrganizationBody(request: Request): Promise<UpdateOrganizationBodyDto> {
  return await updateOrganizationRequest.validate(request);
}

export type {
  CreateOrganizationBodyDto,
  OrganizationIdParams,
  OrganizationListQueryDto,
  UpdateOrganizationBodyDto,
};
export {
  CreateOrganizationRequest,
  OrganizationListQueryRequest,
  parseCreateOrganizationBody,
  parseOrganizationIdParams,
  parseOrganizationListQuery,
  parseUpdateOrganizationBody,
  UpdateOrganizationRequest,
};
