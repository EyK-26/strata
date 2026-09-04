import { FormRequest } from "@getstrata/core/http/formRequest";
import { expectObject } from "@getstrata/core/http/validation";

export class PublishCareerRequest extends FormRequest<{ expires_at: string | null }> {
  protected parse(payload: unknown) {
    const body = expectObject(payload ?? {});
    return {
      expires_at: typeof body.expires_at === "string" ? body.expires_at : null,
    };
  }
}
