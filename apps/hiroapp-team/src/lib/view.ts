import { join } from "node:path";
import { resolveCsrfTokenForRequest } from "@getstrata/core/http/csrfToken";
import { EtaViewEngine, htmlResponse } from "@getstrata/core/view";

const engine = new EtaViewEngine(join(import.meta.dir, "../../views"));

export interface LayoutData {
  title: string;
  description?: string;
}

export async function renderPage(
  template: string,
  data: Record<string, unknown> & { layout: LayoutData },
  request?: Request,
): Promise<Response> {
  const csrfToken = request ? resolveCsrfTokenForRequest(request) : "";
  const html = await engine.render(template, { ...data, csrfToken });
  return htmlResponse(html);
}

export function plainText(body: string): Response {
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8" } });
}
