import { ValidationError } from "@getstrata/core/errors/http";
import { FormRequest } from "@getstrata/core/http/formRequest";
import { expectObject } from "@getstrata/core/http/validation";

export class DepartmentNameRequest extends FormRequest<{ name: string }> {
  protected parse(payload: unknown) {
    const body = expectObject(payload);
    const name = typeof body.name === "string" ? body.name : "";
    if (!name.trim()) {
      throw new ValidationError("The given data was invalid.", {
        name: ["The name field is required."],
      });
    }
    return { name };
  }
}
