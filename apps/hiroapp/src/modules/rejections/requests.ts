import { ValidationError } from "@getstrata/core/errors/http";
import { FormRequest } from "@getstrata/core/http/formRequest";
import { expectObject } from "@getstrata/core/http/validation";

export class RejectApplicationRequest extends FormRequest<{
  reason_id: number;
  notes: string | null;
}> {
  protected parse(payload: unknown) {
    const body = expectObject(payload);
    const reason_id = Number(body.reason_id);
    if (!Number.isInteger(reason_id) || reason_id <= 0) {
      throw new ValidationError("The given data was invalid.", {
        reason_id: ["The rejection reason is required."],
      });
    }
    return {
      reason_id,
      notes: typeof body.notes === "string" ? body.notes : null,
    };
  }
}
