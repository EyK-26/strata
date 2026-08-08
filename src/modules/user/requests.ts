import { FormRequest, parsePositiveIntParam } from "../../core/http";
import {
  maxLength,
  minLength,
  optional,
  required,
  stringRule,
  validateObject,
} from "../../core/validation/rules";

type TokenIdParams = { id: string };
type OAuthProviderParams = { provider: string };

interface LoginBodyDto {
  email: string;
  password: string;
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
    });

    return {
      email: validated.email as string,
      password: validated.password as string,
    };
  }
}

const loginRequest = new LoginRequest();

function parseTokenIdParams(params: TokenIdParams): { id: number } {
  return {
    id: parsePositiveIntParam(params.id, "token id"),
  };
}

async function parseCreateApiTokenBody(request: Request): Promise<CreateApiTokenBodyDto> {
  return await createApiTokenRequest.validate(request);
}

async function parseLoginBody(request: Request): Promise<LoginBodyDto> {
  return await loginRequest.validate(request);
}

export type { CreateApiTokenBodyDto, LoginBodyDto, OAuthProviderParams, TokenIdParams };
export { parseCreateApiTokenBody, parseLoginBody, parseTokenIdParams };
