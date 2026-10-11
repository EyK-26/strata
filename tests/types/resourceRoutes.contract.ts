import type { AppRouteMap } from "@getstrata/bootstrap/contracts";
import type { RouteHandler } from "@getstrata/core/http/middleware";
import { mergeRouteMaps, resourceRoutes } from "@getstrata/core/http/route";

const routes = resourceRoutes("/orders", {
  index: (_request: Request) => Response.json([]),
  show: (request) => Response.json({ id: request.params.id }),
});
const appRoutes: AppRouteMap = routes;
void appRoutes;
const get: RouteHandler<Request> | undefined = routes["/orders"]?.GET;
void get;
const nativeServer = () => Bun.serve({ routes, fetch: () => new Response() });
void nativeServer;
const combined = mergeRouteMaps(routes, { "/health": { GET: () => new Response("ok") } });
combined["/health"].GET();
// @ts-expect-error No implicit custom action exposure.
resourceRoutes("/orders", { refund: () => new Response() });
resourceRoutes("/orders", {
  // @ts-expect-error Member actions require the declared id contract, not a different parameter.
  show: (request: Request & { params: { slug: string } }) => new Response(request.params.slug),
});

function kernelContract(kernel: import("@getstrata/bootstrap/httpKernel").HttpKernel) {
  return resourceRoutes("/orders", {
    show: kernel.wrapWebAuthenticated(
      (request: Request & { params: { id: string } }) => new Response(request.params.id),
    ),
  });
}
void kernelContract;
const extra = { index: (_request: Request) => new Response(), refund: () => new Response() };
// @ts-expect-error Extra actions also fail when supplied through a variable.
resourceRoutes("/orders", extra);
// @ts-expect-error Omitted actions are not present in the inferred map.
routes["/orders/create"];
