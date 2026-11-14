import { FormRequest } from "./formRequest";
import { type FormBodyOptions, parseFormBody } from "./parseFormBody";
import { parseJsonBody } from "./validation";

abstract class WebFormRequest<TOutput> extends FormRequest<TOutput> {
  readonly #preserveRepeated: boolean;

  constructor(options: FormBodyOptions = {}) {
    super();
    this.#preserveRepeated = options.preserveRepeated === true;
  }

  protected override readPayload(request: Request): Promise<unknown> {
    // Accept negotiates the response, never the encoding of the request body.
    const mediaType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    return mediaType === "application/json" || mediaType?.match(/^application\/[^/]+\+json$/)
      ? parseJsonBody(request, (body) => body)
      : parseFormBody(request, { preserveRepeated: this.#preserveRepeated });
  }
}

export { WebFormRequest };
