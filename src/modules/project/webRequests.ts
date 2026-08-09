import { ValidationError } from "@getstrata/core/errors/http";
import { WebFormRequest } from "@getstrata/core/http/webFormRequest";
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
import { PROJECT_STATUSES, type ProjectStatus } from "../../domain/workhub";

interface WebCreateProjectBody {
  organization_id: number;
  name: string;
  status?: ProjectStatus;
}

interface WebUpdateProjectBody {
  name?: string;
  status?: ProjectStatus;
}

const webCreateProjectRules = {
  organization_id: [required(), positiveIntegerRule()],
  name: [required(), stringRule(), minLength(1), maxLength(120)],
  status: [optional(), enumRule(PROJECT_STATUSES)],
};

const webUpdateProjectRules = {
  name: [optional(), stringRule(), minLength(1), maxLength(120)],
  status: [optional(), enumRule(PROJECT_STATUSES)],
};

function parseWebCreateProjectPayload(payload: unknown): WebCreateProjectBody {
  const validated = validateObject(payload, webCreateProjectRules);

  return {
    organization_id: Number.parseInt(String(validated.organization_id), 10),
    name: String(validated.name).trim(),
    ...(validated.status === undefined ? {} : { status: validated.status as ProjectStatus }),
  };
}

function parseWebUpdateProjectPayload(payload: unknown): WebUpdateProjectBody {
  const validated = validateObject(payload, webUpdateProjectRules);
  const changes: WebUpdateProjectBody = {};

  if (validated.name !== undefined) {
    changes.name = String(validated.name).trim();
  }

  if (validated.status !== undefined) {
    changes.status = validated.status as ProjectStatus;
  }

  if (changes.name === undefined && changes.status === undefined) {
    throw new ValidationError("The given data was invalid.", {
      name: ["At least one of name or status must be provided."],
    });
  }

  return changes;
}

class WebCreateProjectRequest extends WebFormRequest<WebCreateProjectBody> {
  protected parse(payload: unknown): WebCreateProjectBody {
    return parseWebCreateProjectPayload(payload);
  }
}

class WebUpdateProjectRequest extends WebFormRequest<WebUpdateProjectBody> {
  protected parse(payload: unknown): WebUpdateProjectBody {
    return parseWebUpdateProjectPayload(payload);
  }
}

const webCreateProjectRequest = new WebCreateProjectRequest();
const webUpdateProjectRequest = new WebUpdateProjectRequest();

async function parseWebCreateProjectBody(request: Request): Promise<WebCreateProjectBody> {
  return await webCreateProjectRequest.validate(request);
}

async function parseWebUpdateProjectBody(request: Request): Promise<WebUpdateProjectBody> {
  return await webUpdateProjectRequest.validate(request);
}

export type { WebCreateProjectBody, WebUpdateProjectBody };
export {
  parseWebCreateProjectBody,
  parseWebCreateProjectPayload,
  parseWebUpdateProjectBody,
  parseWebUpdateProjectPayload,
};
