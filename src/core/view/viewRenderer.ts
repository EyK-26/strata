import { createServiceToken } from "../contracts/container";
import { currentRequestMeta } from "../http/requestMetaContext";
import type { ViewEngine } from "./viewEngine";

interface ViewResponseOptions {
  layout?: string | false;
  request?: Request;
  status?: number;
  statusText?: string;
  headers?: ConstructorParameters<typeof Headers>[0];
}

interface HtmxViewResponseOptions extends ViewResponseOptions {
  /** Optional fragment template; otherwise render the page template without its layout. */
  fragment?: string;
}

const HTMX_VARY_HEADERS = ["HX-Request", "HX-Boosted", "HX-History-Restore-Request"];

function varyByHtmx(headers: Headers): void {
  const existing = (headers.get("Vary") ?? "").split(",").map((field) => field.trim());
  if (existing.includes("*")) return;
  const fields = new Map<string, string>();
  for (const field of [...existing, ...HTMX_VARY_HEADERS]) {
    if (field) fields.set(field.toLowerCase(), field);
  }
  headers.set("Vary", [...fields.values()].join(", "));
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

  /** Opt-in representation selection; auth/CSRF/tenancy remain the route's responsibility. */
  async renderHtmx(
    name: string,
    data: Record<string, unknown> = {},
    options: HtmxViewResponseOptions = {},
  ): Promise<Response> {
    const request = options.request ?? currentRequestMeta().request;
    if (!request) throw new Error("HTMX view rendering requires a request.");
    const fragment =
      request.headers.get("HX-Request") === "true" &&
      request.headers.get("HX-Boosted") !== "true" &&
      request.headers.get("HX-History-Restore-Request") !== "true";
    const headers = new Headers(options.headers);
    varyByHtmx(headers);
    return this.render(fragment ? (options.fragment ?? name) : name, data, {
      ...options,
      request,
      headers,
      layout: fragment ? false : options.layout,
    });
  }
}

const CORE_VIEW_RENDERER_TOKEN = createServiceToken<ViewRenderer>("core.viewRenderer");

export type { HtmxViewResponseOptions, ViewResponseOptions };
export { CORE_VIEW_RENDERER_TOKEN, ViewRenderer };
