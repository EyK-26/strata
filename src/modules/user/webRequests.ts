import { WebFormRequest } from "@getstrata/core/http/webFormRequest";
import { required, stringRule, validateObject } from "@getstrata/core/validation/rules";

interface WebLoginBody {
  email: string;
  password: string;
  redirect?: string;
}

const webLoginRules = {
  email: [required(), stringRule()],
  password: [required(), stringRule()],
  redirect: [stringRule()],
};

class WebLoginRequest extends WebFormRequest<WebLoginBody> {
  protected parse(payload: unknown): WebLoginBody {
    const validated = validateObject(payload, webLoginRules);

    return {
      email: String(validated.email).trim(),
      password: String(validated.password),
      ...(validated.redirect ? { redirect: String(validated.redirect) } : {}),
    };
  }
}

const webLoginRequest = new WebLoginRequest();

async function parseWebLoginBody(request: Request): Promise<WebLoginBody> {
  return await webLoginRequest.validate(request);
}

export type { WebLoginBody };
export { parseWebLoginBody };
