import { BadRequestError, ForbiddenError } from "@getstrata/core/errors/http";
import { FormRequest } from "@getstrata/core/http/formRequest";
import { expectObject } from "@getstrata/core/http/validation";

export class PublishCareerRequest extends FormRequest<{ expires_at: string | null }> {
  async validate(request: Request) {
    if (!(await this.authorize(request))) {
      throw new ForbiddenError();
    }
    const raw = await request.text();
    if (!raw.trim()) {
      return this.parse({});
    }
    let payload: unknown;
    try {
      payload = JSON.parse(raw) as unknown;
    } catch {
      throw new BadRequestError("Request body must be valid JSON.");
    }
    return this.parse(payload);
  }

  protected parse(payload: unknown) {
    const body = expectObject(payload ?? {});
    return {
      expires_at: typeof body.expires_at === "string" ? body.expires_at : null,
    };
  }
}
