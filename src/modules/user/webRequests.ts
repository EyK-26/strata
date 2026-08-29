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

interface WebConfirmMfaBody {
  mfaCode: string;
}

interface WebDisableMfaBody {
  password: string;
}

interface WebChangePasswordBody {
  currentPassword: string;
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

const webConfirmMfaRules = {
  mfa_code: [required(), stringRule(), minLength(6), maxLength(6)],
};

const webDisableMfaRules = {
  password: [required(), stringRule()],
};

const webChangePasswordRules = {
  current_password: [required(), stringRule()],
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

class WebConfirmMfaRequest extends WebFormRequest<WebConfirmMfaBody> {
  protected parse(payload: unknown): WebConfirmMfaBody {
    const validated = validateObject(payload, webConfirmMfaRules);

    return { mfaCode: String(validated.mfa_code) };
  }
}

class WebDisableMfaRequest extends WebFormRequest<WebDisableMfaBody> {
  protected parse(payload: unknown): WebDisableMfaBody {
    const validated = validateObject(payload, webDisableMfaRules);

    return { password: String(validated.password) };
  }
}

class WebChangePasswordRequest extends WebFormRequest<WebChangePasswordBody> {
  protected parse(payload: unknown): WebChangePasswordBody {
    const validated = validateObject(payload, webChangePasswordRules);

    return {
      currentPassword: String(validated.current_password),
      password: String(validated.password),
    };
  }
}

const webLoginRequest = new WebLoginRequest();
const webForgotPasswordRequest = new WebForgotPasswordRequest();
const webResetPasswordRequest = new WebResetPasswordRequest();
const webConfirmMfaRequest = new WebConfirmMfaRequest();
const webDisableMfaRequest = new WebDisableMfaRequest();
const webChangePasswordRequest = new WebChangePasswordRequest();

async function parseWebLoginBody(request: Request): Promise<WebLoginBody> {
  return await webLoginRequest.validate(request);
}

async function parseWebForgotPasswordBody(request: Request): Promise<WebForgotPasswordBody> {
  return await webForgotPasswordRequest.validate(request);
}

async function parseWebResetPasswordBody(request: Request): Promise<WebResetPasswordBody> {
  return await webResetPasswordRequest.validate(request);
}

async function parseWebConfirmMfaBody(request: Request): Promise<WebConfirmMfaBody> {
  return await webConfirmMfaRequest.validate(request);
}

async function parseWebDisableMfaBody(request: Request): Promise<WebDisableMfaBody> {
  return await webDisableMfaRequest.validate(request);
}

async function parseWebChangePasswordBody(request: Request): Promise<WebChangePasswordBody> {
  return await webChangePasswordRequest.validate(request);
}

export type {
  WebChangePasswordBody,
  WebConfirmMfaBody,
  WebDisableMfaBody,
  WebForgotPasswordBody,
  WebLoginBody,
  WebResetPasswordBody,
};
export {
  parseWebChangePasswordBody,
  parseWebConfirmMfaBody,
  parseWebDisableMfaBody,
  parseWebForgotPasswordBody,
  parseWebLoginBody,
  parseWebResetPasswordBody,
};
