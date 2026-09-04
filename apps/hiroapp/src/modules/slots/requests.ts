import { ValidationError } from "@getstrata/core/errors/http";
import { FormRequest } from "@getstrata/core/http/formRequest";
import { expectObject } from "@getstrata/core/http/validation";

export class CreateSlotRequest extends FormRequest<{
  starts_at: string;
  ends_at: string;
}> {
  protected parse(payload: unknown) {
    const body = expectObject(payload);
    const starts_at = typeof body.starts_at === "string" ? body.starts_at.trim() : "";
    const ends_at = typeof body.ends_at === "string" ? body.ends_at.trim() : "";
    if (!starts_at) {
      throw new ValidationError("The given data was invalid.", {
        starts_at: ["The start time is required."],
      });
    }
    if (!ends_at) {
      throw new ValidationError("The given data was invalid.", {
        ends_at: ["The end time is required."],
      });
    }
    return { starts_at, ends_at };
  }
}
