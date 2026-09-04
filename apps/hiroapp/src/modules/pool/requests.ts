import { ValidationError } from "@getstrata/core/errors/http";
import { FormRequest } from "@getstrata/core/http/formRequest";
import { expectObject } from "@getstrata/core/http/validation";

export class AddPoolRequest extends FormRequest<{
  user_id: number;
  notes: string | null;
  application_id: number | null;
}> {
  protected parse(payload: unknown) {
    const body = expectObject(payload);
    const user_id = Number(body.user_id);
    if (!Number.isInteger(user_id) || user_id <= 0) {
      throw new ValidationError("The given data was invalid.", {
        user_id: ["The candidate is required."],
      });
    }
    const rawApplication = body.application_id;
    let application_id: number | null = null;
    if (rawApplication != null && rawApplication !== "") {
      application_id = Number(rawApplication);
      if (!Number.isInteger(application_id) || application_id <= 0) {
        throw new ValidationError("The given data was invalid.", {
          application_id: ["The source application is invalid."],
        });
      }
    }
    return {
      user_id,
      notes: typeof body.notes === "string" ? body.notes : null,
      application_id,
    };
  }
}

export class AddPoolFromApplicationRequest extends FormRequest<{
  notes: string | null;
}> {
  protected parse(payload: unknown) {
    const body = expectObject(payload);
    return {
      notes: typeof body.notes === "string" ? body.notes : null,
    };
  }
}

export class ReachOutRequest extends FormRequest<{
  subject: string | null;
  text: string;
}> {
  protected parse(payload: unknown) {
    const body = expectObject(payload);
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text) {
      throw new ValidationError("The given data was invalid.", {
        text: ["The message field is required."],
      });
    }
    return {
      subject: typeof body.subject === "string" ? body.subject : null,
      text,
    };
  }
}
