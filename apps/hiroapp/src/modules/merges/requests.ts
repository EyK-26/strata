import { ValidationError } from "@getstrata/core/errors/http";
import { FormRequest } from "@getstrata/core/http/formRequest";
import { expectObject } from "@getstrata/core/http/validation";

export class CreateMergeRequest extends FormRequest<{
  source_id: number;
  target_id: number;
}> {
  protected parse(payload: unknown) {
    const body = expectObject(payload);
    const source_id = Number(body.source_id);
    const target_id = Number(body.target_id);
    if (!Number.isInteger(source_id) || source_id <= 0) {
      throw new ValidationError("The given data was invalid.", {
        source_id: ["The source candidate is required."],
      });
    }
    if (!Number.isInteger(target_id) || target_id <= 0) {
      throw new ValidationError("The given data was invalid.", {
        target_id: ["The target candidate is required."],
      });
    }
    return { source_id, target_id };
  }
}
