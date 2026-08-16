import { ForbiddenError, ValidationError } from "@getstrata/core/errors/http";
import { requestPrefersJson } from "./contentNegotiation";
import { parseFormBody } from "./parseFormBody";
import { parseJsonBody } from "./validation";

abstract class WebFormRequest<TOutput> {
  authorize(_request: Request): boolean | Promise<boolean> {
    return true;
  }

  protected abstract parse(payload: unknown): TOutput;

  validatePayload(payload: unknown): TOutput {
    return this.parse(payload);
  }

  async validate(request: Request): Promise<TOutput> {
    if (!(await this.authorize(request))) {
      throw new ForbiddenError();
    }

    const payload = requestPrefersJson(request)
      ? await parseJsonBody(request, (body) => body)
      : await parseFormBody(request);

    try {
      return this.validatePayload(payload);
    } catch (error) {
      if (error instanceof ValidationError) {
        throw error;
      }

      throw error;
    }
  }
}

export { WebFormRequest };
