import { ValidationError } from "@getstrata/core/errors/http";
import { FormRequest } from "@getstrata/core/http/formRequest";
import { expectObject } from "@getstrata/core/http/validation";

export class RecordSourceRequest extends FormRequest<{
  source_id: number;
  notes: string | null;
}> {
  protected parse(payload: unknown) {
    const body = expectObject(payload);
    const source_id = Number(body.source_id);
    if (!Number.isInteger(source_id) || source_id <= 0) {
      throw new ValidationError("The given data was invalid.", {
        source_id: ["The application source is required."],
      });
    }
    return {
      source_id,
      notes: typeof body.notes === "string" ? body.notes : null,
    };
  }
}
