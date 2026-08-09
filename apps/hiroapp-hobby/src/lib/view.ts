import { join } from "node:path";
import { resolveCsrfTokenForRequest } from "@getstrata/core/http/csrfToken";
import { currentRequestMeta } from "@getstrata/core/http/requestMetaContext";
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
  status = 200,
): Promise<Response> {
  const csrfToken = request ? resolveCsrfTokenForRequest(request) : "";
  const flash = currentRequestMeta().flash ?? null;
  const currentUser = null;
  const html = await engine.render(
    template,
    { ...data, csrfToken, flash, currentUser },
    { request },
  );
  return htmlResponse(html, { status });
}

export function plainText(body: string): Response {
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8" } });
}
