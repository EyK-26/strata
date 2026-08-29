import { WebFormRequest } from "@getstrata/core/http/webFormRequest";
import {
  emailRule,
  maxLength,
  minLength,
  required,
  stringRule,
  validateObject,
} from "@getstrata/core/validation/rules";

interface WebLoginBody {
  email: string;
  password: string;
  redirect?: string;
  mfaCode?: string;
}

interface WebForgotPasswordBody {
  email: string;
}

interface WebResetPasswordBody {
  email: string;
  token: string;
  password: string;
}

const webLoginRules = {
  email: [required(), stringRule(), emailRule()],
  password: [required(), stringRule()],
  redirect: [stringRule()],
  mfa_code: [stringRule()],
};

const webForgotPasswordRules = {
  email: [required(), stringRule(), emailRule()],
};

const webResetPasswordRules = {
  email: [required(), stringRule(), emailRule()],
  token: [required(), stringRule()],
  password: [required(), stringRule(), minLength(8), maxLength(128)],
};

class WebLoginRequest extends WebFormRequest<WebLoginBody> {
  protected parse(payload: unknown): WebLoginBody {
    const validated = validateObject(payload, webLoginRules);

    return {
      email: String(validated.email).trim(),
      password: String(validated.password),
      ...(validated.redirect ? { redirect: String(validated.redirect) } : {}),
      ...(validated.mfa_code ? { mfaCode: String(validated.mfa_code) } : {}),
    };
  }
}

class WebForgotPasswordRequest extends WebFormRequest<WebForgotPasswordBody> {
  protected parse(payload: unknown): WebForgotPasswordBody {
    const validated = validateObject(payload, webForgotPasswordRules);

    return { email: String(validated.email).trim() };
  }
}

class WebResetPasswordRequest extends WebFormRequest<WebResetPasswordBody> {
  protected parse(payload: unknown): WebResetPasswordBody {
    const validated = validateObject(payload, webResetPasswordRules);

    return {
      email: String(validated.email).trim(),
      token: String(validated.token),
      password: String(validated.password),
    };
  }
}

const webLoginRequest = new WebLoginRequest();
const webForgotPasswordRequest = new WebForgotPasswordRequest();
const webResetPasswordRequest = new WebResetPasswordRequest();

async function parseWebLoginBody(request: Request): Promise<WebLoginBody> {
  return await webLoginRequest.validate(request);
}

async function parseWebForgotPasswordBody(request: Request): Promise<WebForgotPasswordBody> {
  return await webForgotPasswordRequest.validate(request);
}

async function parseWebResetPasswordBody(request: Request): Promise<WebResetPasswordBody> {
  return await webResetPasswordRequest.validate(request);
}

export type { WebForgotPasswordBody, WebLoginBody, WebResetPasswordBody };
export { parseWebForgotPasswordBody, parseWebLoginBody, parseWebResetPasswordBody };
