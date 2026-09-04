import { ValidationError } from "@getstrata/core/errors/http";
import { FormRequest } from "@getstrata/core/http/formRequest";
import { expectObject } from "@getstrata/core/http/validation";

export interface LoginPayload {
  email: string;
  password: string;
}

export class LoginRequest extends FormRequest<LoginPayload> {
  protected parse(payload: unknown): LoginPayload {
    const body = expectObject(payload);
    const errors: Record<string, string[]> = {};
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!email) errors.email = ["The email field is required."];
    if (!password) errors.password = ["The password field is required."];
    if (Object.keys(errors).length > 0) {
      throw new ValidationError("The given data was invalid.", errors);
    }
    return { email: email.toLowerCase(), password };
  }
}
