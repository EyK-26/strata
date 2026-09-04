import { ValidationError } from "@getstrata/core/errors/http";
import { FormRequest, QueryFormRequest } from "@getstrata/core/http/formRequest";
import { expectObject, getQueryParams } from "@getstrata/core/http/validation";

export interface CreateApplicationPayload {
  position_id: number;
  attachment_text: string | null;
  attachment_file: string | null;
}

export class CreateApplicationRequest extends FormRequest<CreateApplicationPayload> {
  protected parse(payload: unknown): CreateApplicationPayload {
    const body = expectObject(payload);
    const position_id = Number(body.position_id);
    if (!Number.isInteger(position_id) || position_id <= 0) {
      throw new ValidationError("The given data was invalid.", {
        position_id: ["The position is required."],
      });
    }
    return {
      position_id,
      attachment_text: typeof body.attachment_text === "string" ? body.attachment_text : null,
      attachment_file: typeof body.attachment_file === "string" ? body.attachment_file : null,
    };
  }
}

export class ApplicationIndexRequest extends QueryFormRequest<{
  search: string;
  status_id?: number;
  department_id?: number;
}> {
  protected parseQuery(request?: Request) {
    const params = getQueryParams(request);
    const statusRaw = Number(params.get("status_id") ?? 0);
    const departmentRaw = Number(params.get("department_id") ?? 0);
    return {
      search: params.get("search") ?? "",
      status_id: Number.isInteger(statusRaw) && statusRaw > 0 ? statusRaw : undefined,
      department_id:
        Number.isInteger(departmentRaw) && departmentRaw > 0 ? departmentRaw : undefined,
    };
  }
}

export class InterviewNotifyRequest extends FormRequest<{
  text: string;
  datetime: string;
  place: string;
  applicant_id: number;
  sender: { id?: number; first_name: string; last_name: string; email: string };
}> {
  protected parse(payload: unknown) {
    const body = expectObject(payload);
    const applicant_id = Number(body.applicant_id);
    if (!Number.isInteger(applicant_id) || applicant_id <= 0) {
      throw new ValidationError("The given data was invalid.", {
        applicant_id: ["The applicant is required."],
      });
    }
    const sender = expectObject(body.sender ?? {}, "sender");
    return {
      text: String(body.text ?? ""),
      datetime: String(body.datetime ?? ""),
      place: String(body.place ?? ""),
      applicant_id,
      sender: {
        id: sender.id ? Number(sender.id) : undefined,
        first_name: String(sender.first_name ?? ""),
        last_name: String(sender.last_name ?? ""),
        email: String(sender.email ?? ""),
      },
    };
  }
}
