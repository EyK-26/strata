import { FormRequest } from "@getstrata/core/http/formRequest";
import { parsePositiveIntParam } from "@getstrata/core/http/validation";
import {
  maxLength,
  minLength,
  optional,
  required,
  stringRule,
  validateObject,
} from "@getstrata/core/validation/rules";

type TokenIdParams = { id: string };
type NotificationIdParams = { id: string };
type OAuthProviderParams = { provider: string };

interface NotificationListQuery {
  page: number;
  perPage: number;
  unreadOnly: boolean;
}

interface LoginBodyDto {
  email: string;
  password: string;
  mfa_code?: string;
}

interface CreateApiTokenBodyDto {
  name: string;
  abilities?: string[];
  expires_in_days?: number;
}

class CreateApiTokenRequest extends FormRequest<CreateApiTokenBodyDto> {
  protected parse(payload: unknown): CreateApiTokenBodyDto {
    const validated = validateObject(payload, {
      name: [required(), stringRule(), minLength(1), maxLength(120)],
      abilities: [optional()],
      expires_in_days: [optional()],
    });

    const abilities = validated.abilities;

    return {
      name: validated.name as string,
      ...(abilities === undefined
        ? {}
        : {
            abilities: Array.isArray(abilities) ? abilities.map(String) : undefined,
          }),
      ...(validated.expires_in_days === undefined
        ? {}
        : { expires_in_days: Number(validated.expires_in_days) }),
    };
  }
}

const createApiTokenRequest = new CreateApiTokenRequest();

class LoginRequest extends FormRequest<LoginBodyDto> {
  protected parse(payload: unknown): LoginBodyDto {
    const validated = validateObject(payload, {
      email: [required(), stringRule(), minLength(3), maxLength(255)],
      password: [required(), stringRule(), minLength(8), maxLength(255)],
      mfa_code: [optional(), stringRule(), minLength(6), maxLength(6)],
    });

    return {
      email: validated.email as string,
      password: validated.password as string,
      ...(validated.mfa_code === undefined ? {} : { mfa_code: validated.mfa_code as string }),
    };
  }
}

const loginRequest = new LoginRequest();

function parseTokenIdParams(params: TokenIdParams): { id: number } {
  return {
    id: parsePositiveIntParam(params.id, "token id"),
  };
}

function parseNotificationIdParams(params: NotificationIdParams): { id: number } {
  return {
    id: parsePositiveIntParam(params.id, "notification id"),
  };
}

function parseNotificationListQuery(request?: Request): NotificationListQuery {
  const url = request ? new URL(request.url) : new URL("http://localhost/");
  const page = Number.parseInt(url.searchParams.get("page") ?? "1", 10);
  const perPage = Number.parseInt(url.searchParams.get("per_page") ?? "20", 10);
  const unreadOnly = url.searchParams.get("unread_only") === "true";

  return {
    page: Number.isInteger(page) && page > 0 ? page : 1,
    perPage: Number.isInteger(perPage) && perPage > 0 ? Math.min(perPage, 100) : 20,
    unreadOnly,
  };
}

async function parseCreateApiTokenBody(request: Request): Promise<CreateApiTokenBodyDto> {
  return await createApiTokenRequest.validate(request);
}

async function parseLoginBody(request: Request): Promise<LoginBodyDto> {
  return await loginRequest.validate(request);
}

export type {
  CreateApiTokenBodyDto,
  LoginBodyDto,
  NotificationIdParams,
  NotificationListQuery,
  OAuthProviderParams,
  TokenIdParams,
};
export {
  parseCreateApiTokenBody,
  parseLoginBody,
  parseNotificationIdParams,
  parseNotificationListQuery,
  parseTokenIdParams,
};
