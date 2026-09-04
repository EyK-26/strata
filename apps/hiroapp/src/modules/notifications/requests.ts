import { ValidationError } from "@getstrata/core/errors/http";
import { FormRequest } from "@getstrata/core/http/formRequest";
import { expectObject } from "@getstrata/core/http/validation";

export class ContactUserRequest extends FormRequest<{
  to: string;
  from: string;
  subject: string;
  text: string;
}> {
  protected parse(payload: unknown) {
    const body = expectObject(payload);
    const errors: Record<string, string[]> = {};
    for (const field of ["to", "from", "subject", "text"] as const) {
      if (typeof body[field] !== "string" || String(body[field]).trim() === "") {
        errors[field] = [`The ${field} field is required.`];
      }
    }
    if (Object.keys(errors).length > 0) {
      throw new ValidationError("The given data was invalid.", errors);
    }
    return {
      to: String(body.to).trim(),
      from: String(body.from).trim(),
      subject: String(body.subject).trim(),
      text: String(body.text),
    };
  }
}

export class MarkReadRequest extends FormRequest<{ id: string }> {
  protected parse(payload: unknown) {
    const body = expectObject(payload);
    if (typeof body.id !== "string" || body.id.trim() === "") {
      throw new ValidationError("The given data was invalid.", {
        id: ["The notification id is required."],
      });
    }
    return { id: body.id };
  }
}
