import type { ServiceContainer } from "@getstrata/core/contracts/container";
import { CORE_VIEW_RENDERER_TOKEN, type ViewRenderer } from "@getstrata/core/view";

function viewContract(container: ServiceContainer, renderer: ViewRenderer): void {
  container.set(CORE_VIEW_RENDERER_TOKEN, renderer);
  const response: Promise<Response> = container
    .resolve(CORE_VIEW_RENDERER_TOKEN)
    .render("orders", {}, { layout: false, headers: new Headers(), status: 422 });
  void response;
  const htmx: Promise<Response> = renderer.renderHtmx(
    "orders",
    {},
    { fragment: "orders/table", request: new Request("http://test/orders") },
  );
  void htmx;
  const scoped = renderer.namespace("orders", {
    headers: new Headers({ "Cache-Control": "private, no-store" }),
  });
  // @ts-expect-error Header defaults require native header values.
  renderer.namespace("orders", { headers: { "X-Invalid": false } });
  const scopedResponse: Promise<Response> = scoped.render("show", {}, { status: 200 });
  const scopedHtmx: Promise<Response> = scoped.renderHtmx(
    "show",
    {},
    { fragment: "table", request: new Request("http://test/orders") },
  );
  void scopedResponse;
  void scopedHtmx;
  // @ts-expect-error Rendering stays explicit and requires a template name.
  scoped.render();
  // @ts-expect-error Scoped rendering preserves layout types.
  scoped.render("show", {}, { layout: true });
  // @ts-expect-error A fragment is a template name, not a response mode boolean.
  renderer.renderHtmx("orders", {}, { fragment: true });
  // @ts-expect-error Typed view DI tokens reject unrelated services.
  container.set(CORE_VIEW_RENDERER_TOKEN, {});
  // @ts-expect-error Layout selection is a template name or false.
  renderer.render("orders", {}, { layout: true });
}
void viewContract;
