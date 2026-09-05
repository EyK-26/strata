import { FormRequest } from "@getstrata/core/http/formRequest";
import { expectObject } from "@getstrata/core/http/validation";

export class CreateHoldRequest extends FormRequest<{
  notes: string | null;
  holds_until: string | null;
}> {
  protected parse(payload: unknown) {
    const body = expectObject(payload);
    return {
      notes: typeof body.notes === "string" ? body.notes : null,
      holds_until: typeof body.holds_until === "string" ? body.holds_until : null,
    };
  }
}
