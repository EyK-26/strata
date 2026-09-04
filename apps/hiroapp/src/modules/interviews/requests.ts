import { ValidationError } from "@getstrata/core/errors/http";
import { FormRequest } from "@getstrata/core/http/formRequest";
import { expectObject } from "@getstrata/core/http/validation";

export class ScheduleInterviewRequest extends FormRequest<{
  application_id: number;
  scheduled_at: string;
  place: string | null;
  notes: string | null;
  text: string;
}> {
  protected parse(payload: unknown) {
    const body = expectObject(payload);
    const application_id = Number(body.application_id);
    if (!Number.isInteger(application_id) || application_id <= 0) {
      throw new ValidationError("The given data was invalid.", {
        application_id: ["The application is required."],
      });
    }
    const scheduled_at = typeof body.scheduled_at === "string" ? body.scheduled_at.trim() : "";
    if (!scheduled_at) {
      throw new ValidationError("The given data was invalid.", {
        scheduled_at: ["The interview time is required."],
      });
    }
    return {
      application_id,
      scheduled_at,
      place: typeof body.place === "string" ? body.place : null,
      notes: typeof body.notes === "string" ? body.notes : null,
      text: String(body.text ?? ""),
    };
  }
}

export class CompleteInterviewRequest extends FormRequest<{ notes: string | null }> {
  protected parse(payload: unknown) {
    const body = expectObject(payload);
    return {
      notes: typeof body.notes === "string" ? body.notes : null,
    };
  }
}

export class RescheduleInterviewRequest extends FormRequest<{
  scheduled_at: string;
  place: string | null | undefined;
  text: string;
}> {
  protected parse(payload: unknown) {
    const body = expectObject(payload);
    const scheduled_at = typeof body.scheduled_at === "string" ? body.scheduled_at.trim() : "";
    if (!scheduled_at) {
      throw new ValidationError("The given data was invalid.", {
        scheduled_at: ["The interview time is required."],
      });
    }
    return {
      scheduled_at,
      place: Object.hasOwn(body, "place")
        ? typeof body.place === "string"
          ? body.place
          : null
        : undefined,
      text: String(body.text ?? ""),
    };
  }
}
