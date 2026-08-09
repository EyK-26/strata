import { ForbiddenError } from "@getstrata/core/errors/http";
import { parseJsonBody } from "./validation";

abstract class FormRequest<TOutput> {
  authorize(_request: Request): boolean | Promise<boolean> {
    return true;
  }

  protected abstract parse(payload: unknown): TOutput;

  async validate(request: Request): Promise<TOutput> {
    if (!(await this.authorize(request))) {
      throw new ForbiddenError();
    }

    return await parseJsonBody(request, (payload) => this.parse(payload));
  }
}

abstract class QueryFormRequest<TOutput> {
  validate(request?: Request): TOutput {
    return this.parseQuery(request);
  }

  protected abstract parseQuery(request?: Request): TOutput;
}

export { FormRequest, QueryFormRequest };
