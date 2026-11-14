import { ForbiddenError } from "@getstrata/core/errors/http";
import { parseJsonBody } from "./validation";

abstract class FormRequest<TOutput> {
  authorize(_request: Request): boolean | Promise<boolean> {
    return true;
  }

  protected abstract parse(payload: unknown): TOutput;

  validatePayload(payload: unknown): TOutput {
    return this.parse(payload);
  }

  protected readPayload(request: Request): Promise<unknown> {
    return parseJsonBody(request, (payload) => payload);
  }

  async validate(request: Request): Promise<TOutput> {
    if ((await this.authorize(request)) !== true) {
      throw new ForbiddenError();
    }

    return this.validatePayload(await this.readPayload(request));
  }
}

abstract class QueryFormRequest<TOutput> {
  validate(request?: Request): TOutput {
    return this.parseQuery(request);
  }

  protected abstract parseQuery(request?: Request): TOutput;
}

export { FormRequest, QueryFormRequest };
