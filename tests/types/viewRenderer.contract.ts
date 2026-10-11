import type { ServiceContainer } from "@getstrata/core/contracts/container";
import { CORE_VIEW_RENDERER_TOKEN, type ViewRenderer } from "@getstrata/core/view";

function viewContract(container: ServiceContainer, renderer: ViewRenderer): void {
  container.set(CORE_VIEW_RENDERER_TOKEN, renderer);
  const response: Promise<Response> = container
    .resolve(CORE_VIEW_RENDERER_TOKEN)
    .render("orders", {}, { layout: false, headers: new Headers(), status: 422 });
  void response;
  // @ts-expect-error Typed view DI tokens reject unrelated services.
  container.set(CORE_VIEW_RENDERER_TOKEN, {});
  // @ts-expect-error Layout selection is a template name or false.
  renderer.render("orders", {}, { layout: true });
}
void viewContract;
