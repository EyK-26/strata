import { ValidationError } from "@getstrata/core/errors/http";
import { WebFormRequest } from "@getstrata/core/http/webFormRequest";
import {
  emailRule,
  maxLength,
  minLength,
  pattern,
  required,
  stringRule,
  validateObject,
} from "@getstrata/core/validation/rules";

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

interface WebCreateOrganizationBody {
  name: string;
  slug: string;
}

const webCreateOrganizationRules = {
  name: [required(), stringRule(), minLength(1), maxLength(120)],
  slug: [required(), stringRule(), minLength(2), maxLength(64), pattern(SLUG_PATTERN)],
};

function parseWebCreateOrganizationPayload(payload: unknown): WebCreateOrganizationBody {
  const validated = validateObject(payload, webCreateOrganizationRules);

  return {
    name: String(validated.name).trim(),
    slug: String(validated.slug).trim(),
  };
}

class WebCreateOrganizationRequest extends WebFormRequest<WebCreateOrganizationBody> {
  protected parse(payload: unknown): WebCreateOrganizationBody {
    return parseWebCreateOrganizationPayload(payload);
  }
}

const webCreateOrganizationRequest = new WebCreateOrganizationRequest();

async function parseWebCreateOrganizationBody(
  request: Request,
): Promise<WebCreateOrganizationBody> {
  return await webCreateOrganizationRequest.validate(request);
}

interface WebUpdateOrganizationBody {
  name?: string;
  slug?: string;
}

interface WebAddOrganizationMemberBody {
  email: string;
  role: "owner" | "admin" | "member";
}

interface WebUpdateOrganizationMemberRoleBody {
  role: "owner" | "admin" | "member";
}

const webUpdateOrganizationRules = {
  name: [stringRule(), minLength(1), maxLength(120)],
  slug: [stringRule(), minLength(2), maxLength(64), pattern(SLUG_PATTERN)],
};

const webAddMemberRules = {
  email: [required(), stringRule(), emailRule()],
  role: [stringRule()],
};

function parseWebUpdateOrganizationPayload(payload: unknown): WebUpdateOrganizationBody {
  const validated = validateObject(payload, webUpdateOrganizationRules);
  const body: WebUpdateOrganizationBody = {};

  if (validated.name) {
    body.name = String(validated.name).trim();
  }

  if (validated.slug) {
    body.slug = String(validated.slug).trim();
  }

  return body;
}

function parseWebUpdateOrganizationMemberRolePayload(
  payload: unknown,
): WebUpdateOrganizationMemberRoleBody {
  const validated = validateObject(payload, { role: [required(), stringRule()] });
  const role = String(validated.role);

  if (role !== "owner" && role !== "admin" && role !== "member") {
    throw new ValidationError("Invalid organization role.", {
      role: ["Invalid organization role."],
    });
  }

  return { role };
}

function parseWebAddOrganizationMemberPayload(payload: unknown): WebAddOrganizationMemberBody {
  const validated = validateObject(payload, webAddMemberRules);
  const role = String(validated.role ?? "member");

  if (role !== "owner" && role !== "admin" && role !== "member") {
    throw new Error("Invalid organization role.");
  }

  return {
    email: String(validated.email).trim(),
    role,
  };
}

class WebUpdateOrganizationRequest extends WebFormRequest<WebUpdateOrganizationBody> {
  protected parse(payload: unknown): WebUpdateOrganizationBody {
    return parseWebUpdateOrganizationPayload(payload);
  }
}

class WebAddOrganizationMemberRequest extends WebFormRequest<WebAddOrganizationMemberBody> {
  protected parse(payload: unknown): WebAddOrganizationMemberBody {
    return parseWebAddOrganizationMemberPayload(payload);
  }
}

const webUpdateOrganizationRequest = new WebUpdateOrganizationRequest();
const webAddOrganizationMemberRequest = new WebAddOrganizationMemberRequest();

async function parseWebUpdateOrganizationBody(
  request: Request,
): Promise<WebUpdateOrganizationBody> {
  return await webUpdateOrganizationRequest.validate(request);
}

async function parseWebAddOrganizationMemberBody(
  request: Request,
): Promise<WebAddOrganizationMemberBody> {
  return await webAddOrganizationMemberRequest.validate(request);
}

export type {
  WebAddOrganizationMemberBody,
  WebCreateOrganizationBody,
  WebUpdateOrganizationBody,
  WebUpdateOrganizationMemberRoleBody,
};
export {
  parseWebAddOrganizationMemberBody,
  parseWebAddOrganizationMemberPayload,
  parseWebCreateOrganizationBody,
  parseWebCreateOrganizationPayload,
  parseWebUpdateOrganizationBody,
  parseWebUpdateOrganizationMemberRolePayload,
  parseWebUpdateOrganizationPayload,
};
