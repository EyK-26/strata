import { ValidationError } from "@getstrata/core/errors/http";
import { FormRequest, QueryFormRequest } from "@getstrata/core/http/formRequest";
import { expectObject, getQueryParams } from "@getstrata/core/http/validation";

export interface CreatePositionPayload {
  name: string;
  description: string | null;
  start_date: string | null;
  end_date: string | null;
  pay_grade: number;
  department_id: number;
}

export class CreatePositionRequest extends FormRequest<CreatePositionPayload> {
  protected parse(payload: unknown): CreatePositionPayload {
    const body = expectObject(payload);
    const errors: Record<string, string[]> = {};
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) errors.name = ["The name field is required."];
    const pay_grade = Number(body.pay_grade);
    if (![1, 2, 3].includes(pay_grade)) errors.pay_grade = ["The pay grade is invalid."];
    const department_id = Number(body.department_id);
    if (!Number.isInteger(department_id) || department_id <= 0) {
      errors.department_id = ["The department is required."];
    }
    if (Object.keys(errors).length > 0) {
      throw new ValidationError("The given data was invalid.", errors);
    }
    const emptyToNull = (value: unknown) => {
      if (typeof value !== "string" || value.trim() === "") return null;
      return value.trim();
    };
    return {
      name,
      description: emptyToNull(body.description),
      start_date: emptyToNull(body.start_date),
      end_date: emptyToNull(body.end_date),
      pay_grade,
      department_id,
    };
  }
}

export class PositionIndexRequest extends QueryFormRequest<{ search: string; department: number }> {
  protected parseQuery(request?: Request) {
    const params = getQueryParams(request);
    return {
      search: params.get("search") ?? "",
      department: Number(params.get("department") ?? 0) || 0,
    };
  }
}
