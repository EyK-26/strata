import { ValidationError } from "@getstrata/core/errors/http";
import { FormRequest, QueryFormRequest } from "@getstrata/core/http/formRequest";
import { expectObject, getQueryParams } from "@getstrata/core/http/validation";
import { ROLE } from "../../lib/roles.ts";

export interface CreateUserPayload {
  first_name: string;
  last_name: string;
  department_id: number;
  position_id: number;
  role_id: number;
}

function requiredString(
  body: Record<string, unknown>,
  field: string,
  errors: Record<string, string[]>,
) {
  const value = body[field];
  if (typeof value !== "string" || value.trim() === "") {
    errors[field] = [`The ${field} field is required.`];
    return "";
  }
  return value.trim();
}

function requiredId(
  body: Record<string, unknown>,
  field: string,
  errors: Record<string, string[]>,
) {
  const value = Number(body[field]);
  if (!Number.isInteger(value) || value <= 0) {
    errors[field] = [`The ${field} field is required.`];
    return 0;
  }
  return value;
}

export class CreateUserRequest extends FormRequest<CreateUserPayload> {
  protected parse(payload: unknown): CreateUserPayload {
    const body = expectObject(payload);
    const errors: Record<string, string[]> = {};
    const first_name = requiredString(body, "first_name", errors);
    const last_name = requiredString(body, "last_name", errors);
    const department_id = requiredId(body, "department_id", errors);
    const position_id = requiredId(body, "position_id", errors);
    const role_id = requiredId(body, "role_id", errors);
    if (role_id && ![ROLE.ADMIN, ROLE.CANDIDATE, ROLE.RECRUITER].includes(role_id as 1 | 2 | 3)) {
      errors.role_id = ["The selected role is invalid."];
    }
    if (Object.keys(errors).length > 0) {
      throw new ValidationError("The given data was invalid.", errors);
    }
    return { first_name, last_name, department_id, position_id, role_id };
  }
}

export class UserIndexRequest extends QueryFormRequest<{ search: string; department: number }> {
  protected parseQuery(request?: Request) {
    const params = getQueryParams(request);
    return {
      search: params.get("search") ?? "",
      department: Number(params.get("department") ?? 0) || 0,
    };
  }
}
