import { ValidationError } from "@getstrata/core/errors/http";
import { FormRequest } from "@getstrata/core/http/formRequest";
import { parsePositiveIntParam } from "@getstrata/core/http/validation";
import {
  confirmed,
  emailRule,
  integerRule,
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

interface RegisterBodyDto {
  name: string;
  email: string;
  password: string;
}

interface ForgotPasswordBodyDto {
  email: string;
}

interface ResetPasswordBodyDto {
  email: string;
  token: string;
  password: string;
}

interface UpdateProfileBodyDto {
  name: string;
  email: string;
}

interface ConfirmMfaBodyDto {
  mfa_code: string;
}

interface TwoFactorChallengeBodyDto {
  code: string;
  mfa_pending?: string;
}

interface PasswordChallengeBodyDto {
  password: string;
}

interface UpdatePasswordBodyDto {
  current_password: string;
  password: string;
}

interface CreateApiTokenBodyDto {
  name: string;
  abilities?: string[];
  expires_in_days?: number;
}

interface SwitchCurrentOrganizationBodyDto {
  organization_id: number;
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
      mfa_code: [optional(), stringRule(), minLength(6), maxLength(20)],
    });

    return {
      email: validated.email as string,
      password: validated.password as string,
      ...(validated.mfa_code === undefined ? {} : { mfa_code: validated.mfa_code as string }),
    };
  }
}

const loginRequest = new LoginRequest();

class RegisterRequest extends FormRequest<RegisterBodyDto> {
  protected parse(payload: unknown): RegisterBodyDto {
    const validated = validateObject(payload, {
      name: [required(), stringRule(), minLength(1), maxLength(120)],
      email: [required(), stringRule(), emailRule()],
      password: [required(), stringRule(), minLength(8), maxLength(128), confirmed("password")],
    });

    return {
      name: String(validated.name).trim(),
      email: String(validated.email).trim(),
      password: validated.password as string,
    };
  }
}

const registerRequest = new RegisterRequest();

class ForgotPasswordRequest extends FormRequest<ForgotPasswordBodyDto> {
  protected parse(payload: unknown): ForgotPasswordBodyDto {
    const validated = validateObject(payload, {
      email: [required(), stringRule(), emailRule()],
    });

    return { email: String(validated.email).trim() };
  }
}

const forgotPasswordRequest = new ForgotPasswordRequest();

class ResetPasswordRequest extends FormRequest<ResetPasswordBodyDto> {
  protected parse(payload: unknown): ResetPasswordBodyDto {
    const validated = validateObject(payload, {
      email: [required(), stringRule(), emailRule()],
      token: [required(), stringRule(), minLength(1)],
      password: [required(), stringRule(), minLength(8), maxLength(128), confirmed("password")],
    });

    return {
      email: String(validated.email).trim(),
      token: String(validated.token),
      password: validated.password as string,
    };
  }
}

const resetPasswordRequest = new ResetPasswordRequest();

class UpdateProfileRequest extends FormRequest<UpdateProfileBodyDto> {
  protected parse(payload: unknown): UpdateProfileBodyDto {
    const validated = validateObject(payload, {
      name: [required(), stringRule(), minLength(1), maxLength(120)],
      email: [required(), stringRule(), emailRule()],
    });

    return {
      name: String(validated.name).trim(),
      email: String(validated.email).trim(),
    };
  }
}

const updateProfileRequest = new UpdateProfileRequest();

class ConfirmMfaRequest extends FormRequest<ConfirmMfaBodyDto> {
  protected parse(payload: unknown): ConfirmMfaBodyDto {
    const validated = validateObject(payload, {
      mfa_code: [required(), stringRule(), minLength(6), maxLength(6)],
    });

    return { mfa_code: String(validated.mfa_code) };
  }
}

const confirmMfaRequest = new ConfirmMfaRequest();

class TwoFactorChallengeRequest extends FormRequest<TwoFactorChallengeBodyDto> {
  protected parse(payload: unknown): TwoFactorChallengeBodyDto {
    const validated = validateObject(payload, {
      code: [optional(), stringRule(), minLength(1), maxLength(20)],
      mfa_code: [optional(), stringRule(), minLength(1), maxLength(20)],
      recovery_code: [optional(), stringRule(), minLength(1), maxLength(20)],
      mfa_pending: [optional(), stringRule(), minLength(1), maxLength(255)],
    });

    const code = [validated.code, validated.mfa_code, validated.recovery_code]
      .map((value) => (typeof value === "string" ? value.trim() : ""))
      .find((value) => value.length > 0);

    if (!code) {
      throw new ValidationError("A two-factor authentication code is required.", {
        code: ["A two-factor authentication code is required."],
      });
    }

    return {
      code,
      ...(validated.mfa_pending === undefined
        ? {}
        : { mfa_pending: String(validated.mfa_pending) }),
    };
  }
}

const twoFactorChallengeRequest = new TwoFactorChallengeRequest();

class PasswordChallengeRequest extends FormRequest<PasswordChallengeBodyDto> {
  protected parse(payload: unknown): PasswordChallengeBodyDto {
    const validated = validateObject(payload, {
      password: [required(), stringRule()],
    });

    return { password: String(validated.password) };
  }
}

const passwordChallengeRequest = new PasswordChallengeRequest();

class UpdatePasswordRequest extends FormRequest<UpdatePasswordBodyDto> {
  protected parse(payload: unknown): UpdatePasswordBodyDto {
    const validated = validateObject(payload, {
      current_password: [required(), stringRule()],
      password: [required(), stringRule(), minLength(8), maxLength(128), confirmed("password")],
    });

    return {
      current_password: String(validated.current_password),
      password: String(validated.password),
    };
  }
}

const updatePasswordRequest = new UpdatePasswordRequest();

class SwitchCurrentOrganizationRequest extends FormRequest<SwitchCurrentOrganizationBodyDto> {
  protected parse(payload: unknown): SwitchCurrentOrganizationBodyDto {
    const validated = validateObject(payload, {
      organization_id: [required(), integerRule()],
    });
    const organizationId = Number.parseInt(String(validated.organization_id), 10);

    if (!Number.isInteger(organizationId) || organizationId <= 0) {
      throw new ValidationError("A valid organization is required.", {
        organization_id: ["A valid organization is required."],
      });
    }

    return { organization_id: organizationId };
  }
}

const switchCurrentOrganizationRequest = new SwitchCurrentOrganizationRequest();

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

async function parseRegisterBody(request: Request): Promise<RegisterBodyDto> {
  return await registerRequest.validate(request);
}

async function parseForgotPasswordBody(request: Request): Promise<ForgotPasswordBodyDto> {
  return await forgotPasswordRequest.validate(request);
}

async function parseResetPasswordBody(request: Request): Promise<ResetPasswordBodyDto> {
  return await resetPasswordRequest.validate(request);
}

async function parseUpdateProfileBody(request: Request): Promise<UpdateProfileBodyDto> {
  return await updateProfileRequest.validate(request);
}

async function parseConfirmMfaBody(request: Request): Promise<ConfirmMfaBodyDto> {
  return await confirmMfaRequest.validate(request);
}

async function parseTwoFactorChallengeBody(request: Request): Promise<TwoFactorChallengeBodyDto> {
  return await twoFactorChallengeRequest.validate(request);
}

async function parsePasswordChallengeBody(request: Request): Promise<PasswordChallengeBodyDto> {
  return await passwordChallengeRequest.validate(request);
}

async function parseUpdatePasswordBody(request: Request): Promise<UpdatePasswordBodyDto> {
  return await updatePasswordRequest.validate(request);
}

async function parseSwitchCurrentOrganizationBody(
  request: Request,
): Promise<SwitchCurrentOrganizationBodyDto> {
  return await switchCurrentOrganizationRequest.validate(request);
}

export type {
  ConfirmMfaBodyDto,
  CreateApiTokenBodyDto,
  ForgotPasswordBodyDto,
  LoginBodyDto,
  NotificationIdParams,
  NotificationListQuery,
  OAuthProviderParams,
  PasswordChallengeBodyDto,
  RegisterBodyDto,
  ResetPasswordBodyDto,
  SwitchCurrentOrganizationBodyDto,
  TokenIdParams,
  TwoFactorChallengeBodyDto,
  UpdatePasswordBodyDto,
  UpdateProfileBodyDto,
};
export {
  parseConfirmMfaBody,
  parseCreateApiTokenBody,
  parseForgotPasswordBody,
  parseLoginBody,
  parseNotificationIdParams,
  parseNotificationListQuery,
  parsePasswordChallengeBody,
  parseRegisterBody,
  parseResetPasswordBody,
  parseSwitchCurrentOrganizationBody,
  parseTokenIdParams,
  parseTwoFactorChallengeBody,
  parseUpdatePasswordBody,
  parseUpdateProfileBody,
};
