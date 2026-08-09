import { WebFormRequest } from "@getstrata/core/http/webFormRequest";
import {
  maxLength,
  minLength,
  required,
  stringRule,
  validateObject,
} from "@getstrata/core/validation/rules";

interface WebCreateCommentBody {
  body: string;
}

interface WebUpdateCommentBody {
  body: string;
}

const webCreateCommentRules = {
  body: [required(), stringRule(), minLength(1), maxLength(4000)],
};

const webUpdateCommentRules = {
  body: [required(), stringRule(), minLength(1), maxLength(4000)],
};

function parseWebCreateCommentPayload(payload: unknown): WebCreateCommentBody {
  const validated = validateObject(payload, webCreateCommentRules);

  return {
    body: String(validated.body).trim(),
  };
}

function parseWebUpdateCommentPayload(payload: unknown): WebUpdateCommentBody {
  const validated = validateObject(payload, webUpdateCommentRules);

  return {
    body: String(validated.body).trim(),
  };
}

class WebCreateCommentRequest extends WebFormRequest<WebCreateCommentBody> {
  protected parse(payload: unknown): WebCreateCommentBody {
    return parseWebCreateCommentPayload(payload);
  }
}

class WebUpdateCommentRequest extends WebFormRequest<WebUpdateCommentBody> {
  protected parse(payload: unknown): WebUpdateCommentBody {
    return parseWebUpdateCommentPayload(payload);
  }
}

const webCreateCommentRequest = new WebCreateCommentRequest();
const webUpdateCommentRequest = new WebUpdateCommentRequest();

async function parseWebCreateCommentBody(request: Request): Promise<WebCreateCommentBody> {
  return await webCreateCommentRequest.validate(request);
}

async function parseWebUpdateCommentBody(request: Request): Promise<WebUpdateCommentBody> {
  return await webUpdateCommentRequest.validate(request);
}

export type { WebCreateCommentBody, WebUpdateCommentBody };
export {
  parseWebCreateCommentBody,
  parseWebCreateCommentPayload,
  parseWebUpdateCommentBody,
  parseWebUpdateCommentPayload,
};
