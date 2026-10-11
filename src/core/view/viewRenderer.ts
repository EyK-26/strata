import { createServiceToken } from "../contracts/container";
import type { ViewEngine } from "./viewEngine";

interface ViewResponseOptions {
  layout?: string | false;
  request?: Request;
  status?: number;
  statusText?: string;
  headers?: ConstructorParameters<typeof Headers>[0];
}

/** App-owned renderer; request data stays in the engine's async resolver. */
class ViewRenderer {
  constructor(
    private readonly engine: ViewEngine,
    private readonly defaultLayout?: string | false,
  ) {}

  async render(
    name: string,
    data: Record<string, unknown> = {},
    options: ViewResponseOptions = {},
  ): Promise<Response> {
    const html = await this.engine.render(name, data, {
      request: options.request,
      layout: options.layout ?? this.defaultLayout,
    });
    const headers = new Headers(options.headers);
    headers.set("Content-Type", "text/html; charset=utf-8");
    return new Response(html, {
      status: options.status ?? 200,
      statusText: options.statusText,
      headers,
    });
  }
}

const CORE_VIEW_RENDERER_TOKEN = createServiceToken<ViewRenderer>("core.viewRenderer");

export type { ViewResponseOptions };
export { CORE_VIEW_RENDERER_TOKEN, ViewRenderer };
