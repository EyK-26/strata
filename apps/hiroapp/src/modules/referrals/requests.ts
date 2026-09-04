import { ValidationError } from "@getstrata/core/errors/http";
import { FormRequest } from "@getstrata/core/http/formRequest";
import { expectObject } from "@getstrata/core/http/validation";

export class CreateReferralRequest extends FormRequest<{
  email: string;
  name: string;
  notes: string | null;
}> {
  protected parse(payload: unknown) {
    const body = expectObject(payload);
    const email = typeof body.email === "string" ? body.email : "";
    const name = typeof body.name === "string" ? body.name : "";
    if (!email.trim()) {
      throw new ValidationError("The given data was invalid.", {
        email: ["The referral email is required."],
      });
    }
    if (!name.trim()) {
      throw new ValidationError("The given data was invalid.", {
        name: ["The referral name is required."],
      });
    }
    return {
      email,
      name,
      notes: typeof body.notes === "string" ? body.notes : null,
    };
  }
}
