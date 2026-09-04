import { ValidationError } from "@getstrata/core/errors/http";
import { FormRequest } from "@getstrata/core/http/formRequest";
import { expectObject } from "@getstrata/core/http/validation";

export class CreateOfferRequest extends FormRequest<{
  salary: number;
  starts_on: string | null;
  notes: string | null;
}> {
  protected parse(payload: unknown) {
    const body = expectObject(payload);
    const salary = Number(body.salary);
    if (!Number.isInteger(salary) || salary <= 0) {
      throw new ValidationError("The given data was invalid.", {
        salary: ["The salary must be a positive integer."],
      });
    }
    return {
      salary,
      starts_on: typeof body.starts_on === "string" ? body.starts_on : null,
      notes: typeof body.notes === "string" ? body.notes : null,
    };
  }
}
