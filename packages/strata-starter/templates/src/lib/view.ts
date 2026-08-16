import { join } from "node:path";
import { EtaViewEngine, htmlResponse } from "@getstrata/core/view";

const engine = new EtaViewEngine(join(import.meta.dir, "../../views"));

export interface LayoutData {
  title: string;
  description?: string;
}

export async function renderPage(
  template: string,
  data: Record<string, unknown> & { layout: LayoutData },
): Promise<Response> {
  const html = await engine.render(template, data);
  return htmlResponse(html);
}

export function plainText(body: string): Response {
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8" } });
}
