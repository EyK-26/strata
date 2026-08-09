import { ValidationError } from "@getstrata/core/errors/http";
import { WebFormRequest } from "@getstrata/core/http/webFormRequest";
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
} from "@getstrata/core/validation/rules";
import { TASK_STATUSES } from "../../domain/workhub";

interface WebCreateTaskBody {
  project_id: number;
  title: string;
  status?: (typeof TASK_STATUSES)[number];
  priority?: number;
}

interface WebUpdateTaskBody {
  title?: string;
  status?: (typeof TASK_STATUSES)[number];
  priority?: number;
}

const webCreateTaskRules = {
  project_id: [required(), positiveIntegerRule()],
  title: [required(), stringRule(), minLength(1), maxLength(200)],
  status: [optional(), enumRule(TASK_STATUSES)],
  priority: [optional(), integerRange(0, 5)],
};

const webUpdateTaskRules = {
  title: [optional(), stringRule(), minLength(1), maxLength(200)],
  status: [optional(), enumRule(TASK_STATUSES)],
  priority: [optional(), integerRange(0, 5)],
};

function parseWebCreateTaskPayload(payload: unknown): WebCreateTaskBody {
  const validated = validateObject(payload, webCreateTaskRules);

  return {
    project_id: Number.parseInt(String(validated.project_id), 10),
    title: String(validated.title).trim(),
    ...(validated.status === undefined
      ? {}
      : { status: validated.status as (typeof TASK_STATUSES)[number] }),
    ...(validated.priority === undefined
      ? {}
      : { priority: Number.parseInt(String(validated.priority), 10) }),
  };
}

function parseWebUpdateTaskPayload(payload: unknown): WebUpdateTaskBody {
  const validated = validateObject(payload, webUpdateTaskRules);
  const changes: WebUpdateTaskBody = {};

  if (validated.title !== undefined) {
    changes.title = String(validated.title).trim();
  }

  if (validated.status !== undefined) {
    changes.status = validated.status as (typeof TASK_STATUSES)[number];
  }

  if (validated.priority !== undefined) {
    changes.priority = Number.parseInt(String(validated.priority), 10);
  }

  if (
    changes.title === undefined &&
    changes.status === undefined &&
    changes.priority === undefined
  ) {
    throw new ValidationError("The given data was invalid.", {
      title: ["At least one of title, status, or priority must be provided."],
    });
  }

  return changes;
}

class WebCreateTaskRequest extends WebFormRequest<WebCreateTaskBody> {
  protected parse(payload: unknown): WebCreateTaskBody {
    return parseWebCreateTaskPayload(payload);
  }
}

class WebUpdateTaskRequest extends WebFormRequest<WebUpdateTaskBody> {
  protected parse(payload: unknown): WebUpdateTaskBody {
    return parseWebUpdateTaskPayload(payload);
  }
}

const webCreateTaskRequest = new WebCreateTaskRequest();
const webUpdateTaskRequest = new WebUpdateTaskRequest();

async function parseWebCreateTaskBody(request: Request): Promise<WebCreateTaskBody> {
  return await webCreateTaskRequest.validate(request);
}

async function parseWebUpdateTaskBody(request: Request): Promise<WebUpdateTaskBody> {
  return await webUpdateTaskRequest.validate(request);
}

export type { WebCreateTaskBody, WebUpdateTaskBody };
export {
  parseWebCreateTaskBody,
  parseWebCreateTaskPayload,
  parseWebUpdateTaskBody,
  parseWebUpdateTaskPayload,
};
