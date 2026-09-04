import { FormRequest } from "@getstrata/core/http/formRequest";
import { expectObject } from "@getstrata/core/http/validation";

export class RequestCheckRequest extends FormRequest<{
  vendor: string | null;
  notes: string | null;
}> {
  protected parse(payload: unknown) {
    const body = expectObject(payload);
    return {
      vendor: typeof body.vendor === "string" ? body.vendor : null,
      notes: typeof body.notes === "string" ? body.notes : null,
    };
  }
}

export class RecordCheckRequest extends FormRequest<{
  notes: string | null;
}> {
  protected parse(payload: unknown) {
    const body = expectObject(payload);
    return {
      notes: typeof body.notes === "string" ? body.notes : null,
    };
  }
}
