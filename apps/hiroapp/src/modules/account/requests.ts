import { ValidationError } from "@getstrata/core/errors/http";
import { FormRequest } from "@getstrata/core/http/formRequest";
import { expectObject } from "@getstrata/core/http/validation";

function readString(body: Record<string, unknown>, key: string) {
  const value = body[key];
  return typeof value === "string" ? value : "";
}

export class UpdateProfileRequest extends FormRequest<{
  first_name: string;
  last_name: string;
  email: string;
}> {
  protected parse(payload: unknown) {
    const body = expectObject(payload);
    const first_name = readString(body, "first_name").trim();
    const last_name = readString(body, "last_name").trim();
    const email = readString(body, "email").trim().toLowerCase();
    const errors: Record<string, string[]> = {};
    if (!first_name) errors.first_name = ["The first name field is required."];
    if (!last_name) errors.last_name = ["The last name field is required."];
    if (!email) errors.email = ["The email field is required."];
    if (Object.keys(errors).length > 0) {
      throw new ValidationError("The given data was invalid.", errors);
    }
    return { first_name, last_name, email };
  }
}

export class UpdatePasswordRequest extends FormRequest<{
  current_password: string;
  password: string;
  password_confirmation: string;
}> {
  protected parse(payload: unknown) {
    const body = expectObject(payload);
    const current_password = readString(body, "current_password");
    const password = readString(body, "password");
    const password_confirmation = readString(body, "password_confirmation");
    const errors: Record<string, string[]> = {};
    if (!current_password) errors.current_password = ["The current password field is required."];
    if (!password) errors.password = ["The password field is required."];
    if (password && password.length < 8) {
      errors.password = ["The password must be at least 8 characters."];
    }
    if (password !== password_confirmation) {
      errors.password_confirmation = ["The password confirmation does not match."];
    }
    if (Object.keys(errors).length > 0) {
      throw new ValidationError("The given data was invalid.", errors);
    }
    return { current_password, password, password_confirmation };
  }
}

export class ConfirmPasswordRequest extends FormRequest<{ password: string }> {
  protected parse(payload: unknown) {
    const body = expectObject(payload);
    const password = readString(body, "password");
    if (!password) {
      throw new ValidationError("The given data was invalid.", {
        password: ["The password field is required."],
      });
    }
    return { password };
  }
}

export class MfaCodeRequest extends FormRequest<{ mfa_code: string }> {
  protected parse(payload: unknown) {
    const body = expectObject(payload);
    const mfa_code = readString(body, "mfa_code").trim();
    if (!mfa_code) {
      throw new ValidationError("The given data was invalid.", {
        mfa_code: ["The MFA code field is required."],
      });
    }
    return { mfa_code };
  }
}

export class CreateTokenRequest extends FormRequest<{ name: string; abilities?: string[] }> {
  protected parse(payload: unknown) {
    const body = expectObject(payload);
    const name = readString(body, "name").trim();
    if (!name) {
      throw new ValidationError("The given data was invalid.", {
        name: ["The name field is required."],
      });
    }
    const rawAbilities = body.abilities;
    const abilities = Array.isArray(rawAbilities) ? rawAbilities.map(String) : undefined;
    return { name, abilities };
  }
}
