import { FormRequest } from "@getstrata/core/http/formRequest";
import { expectObject } from "@getstrata/core/http/validation";

export class CreateHoldRequest extends FormRequest<{
  notes: string | null;
}> {
  protected parse(payload: unknown) {
    const body = expectObject(payload);
    return {
      notes: typeof body.notes === "string" ? body.notes : null,
    };
  }
}
