import { WebFormRequest } from "@getstrata/core/http/webFormRequest";
import {
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

export type { WebCreateOrganizationBody };
export { parseWebCreateOrganizationBody, parseWebCreateOrganizationPayload };
