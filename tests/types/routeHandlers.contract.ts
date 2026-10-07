/** Compiled against both source and packed public declarations; not executed. */
import type { HttpKernel } from "@getstrata/bootstrap/httpKernel";
import { wrapWebLogin, wrapWebRegister } from "@getstrata/bootstrap/web/routing";
import {
  composeMiddleware,
  type Middleware,
  type RouteHandler,
} from "@getstrata/core/http/middleware";
import { withErrorHandling, withJsonErrorHandling } from "@getstrata/core/http/response";
import type { RouteRequest } from "@getstrata/core/http/route";
import { withMiddleware } from "@getstrata/core/http/routeMiddleware";
import { bindRouteModel } from "@getstrata/core/http/routeModelBinding";

type ItemRequest = RouteRequest<{ id: string }>;

export function routeHandlerContracts(
  kernel: HttpKernel,
  request: ItemRequest,
  plain: Request,
): void {
  kernel.wrapLogin(withJsonErrorHandling(async (req) => new Response(req.url)));
  kernel.wrap(
    "api",
    withJsonErrorHandling(async (req) => new Response(req.url)),
  );
  kernel.wrap(
    "api",
    withErrorHandling(async (req) => new Response(req.url)),
  );
  const noArgs = withErrorHandling(() => new Response("ok"));
  noArgs();
  const manyArgs = withJsonErrorHandling(
    (code: number, title: string) => new Response(title, { status: code }),
  );
  manyArgs(200, "ok");
  const handler: RouteHandler<ItemRequest> = (req) => new Response(req.params.id);
  const middleware: Middleware = async (_req, next) => next();
  const bound = bindRouteModel(
    "id",
    async (_id, _req: ItemRequest) => ({ title: "item" }),
    (req, item) => new Response(`${req.params.id}:${item.title}`),
  );
  const wrapped = [
    composeMiddleware(middleware)(handler),
    withMiddleware(middleware)(handler),
    kernel.wrap("api", handler),
    kernel.wrapApi(handler),
    kernel.wrapWeb(handler),
    kernel.wrapWebGuest(handler),
    kernel.wrapWebPublicRead(handler),
    kernel.wrapWebAuthenticated(handler),
    kernel.wrapWebAuthenticatedAllowUnverified(handler),
    kernel.wrapWebVerified(handler),
    kernel.wrapWebPasswordConfirm(handler),
    kernel.wrapWebAbility("items:read", handler),
    kernel.wrapWebGlobalAdmin(handler),
    kernel.wrapAuthenticated(handler),
    kernel.wrapVerified(handler),
    kernel.wrapPublicRead(handler),
    kernel.wrapGlobalAdmin(handler),
    kernel.wrapAbility("items:read", handler),
    kernel.wrapPolicy("item", "view", handler),
    kernel.wrapLogin(handler),
    kernel.wrapSigned(handler),
    kernel.wrapRegister(handler),
    wrapWebLogin(kernel, handler, handler),
    wrapWebRegister(kernel, handler, handler),
    kernel.wrapPublicRead(withJsonErrorHandling(bound)),
  ] as const;
  const noWidening: Extract<(typeof wrapped)[number], RouteHandler> extends never ? true : false =
    true;
  void noWidening;
  for (const route of wrapped) route(request);
  const composed = withMiddleware(middleware)(handler);
  // @ts-expect-error Composition cannot erase required route parameters.
  composed(plain);
  // @ts-expect-error Kernel wrappers cannot erase required route parameters.
  kernel.wrapWeb(handler)(plain);
  // @ts-expect-error Narrow handlers cannot be widened through an explicit type argument.
  kernel.wrap<Request>("api", handler);
  // @ts-expect-error A response handler must return a Response.
  kernel.wrapWeb((req: ItemRequest) => req.params.id);
  bindRouteModel(
    // @ts-expect-error The parameter name must match the request contract.
    "slug",
    async (_id, _req: ItemRequest) => ({}),
    (req: ItemRequest) => new Response(req.params.id),
  );
  // Plain Request handlers remain supported.
  const legacy: RouteHandler = kernel.wrapWeb((req: Request) => new Response(req.url));
  legacy(plain);
}
