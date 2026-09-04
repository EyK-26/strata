import type { EtaViewEngine } from "@getstrata/core/view";
import { htmlResponse } from "@getstrata/core/view";

let viewEngine: EtaViewEngine | undefined;

export function bindViewEngine(engine: EtaViewEngine) {
  viewEngine = engine;
}

export async function renderPage(
  request: Request,
  name: string,
  data: Record<string, unknown> = {},
  status = 200,
  layout?: string | false,
) {
  if (!viewEngine) {
    throw new Error("View engine is not bound.");
  }
  const html = await viewEngine.render(name, data, { request, layout });
  return htmlResponse(html, { status });
}
