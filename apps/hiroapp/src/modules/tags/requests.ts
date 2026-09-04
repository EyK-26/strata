import { ValidationError } from "@getstrata/core/errors/http";
import { FormRequest } from "@getstrata/core/http/formRequest";
import { expectObject } from "@getstrata/core/http/validation";

export class CreateTagRequest extends FormRequest<{
  label: string;
}> {
  protected parse(payload: unknown) {
    const body = expectObject(payload);
    const label = typeof body.label === "string" ? body.label : "";
    if (!label.trim()) {
      throw new ValidationError("The given data was invalid.", {
        label: ["The tag label is required."],
      });
    }
    return { label };
  }
}
