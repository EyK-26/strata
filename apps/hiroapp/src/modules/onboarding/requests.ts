import { ValidationError } from "@getstrata/core/errors/http";
import { FormRequest } from "@getstrata/core/http/formRequest";
import { expectObject } from "@getstrata/core/http/validation";

export class CreateOnboardingRequest extends FormRequest<{
  title: string;
  notes: string | null;
}> {
  protected parse(payload: unknown) {
    const body = expectObject(payload);
    const title = typeof body.title === "string" ? body.title : "";
    if (!title.trim()) {
      throw new ValidationError("The given data was invalid.", {
        title: ["The onboarding item title is required."],
      });
    }
    return {
      title,
      notes: typeof body.notes === "string" ? body.notes : null,
    };
  }
}
