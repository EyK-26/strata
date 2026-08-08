import { parsePositiveIntParam } from "./validation";
import type { RouteRequest } from "./route";

function bindRouteModel<
  TParams extends Record<string, string>,
  TModel,
  TParam extends keyof TParams & string,
>(
  param: TParam,
  resolver: (id: number, request: RouteRequest<TParams>) => Promise<TModel>,
  handler: (
    request: RouteRequest<TParams>,
    model: TModel,
  ) => Response | Promise<Response>,
): (request: RouteRequest<TParams>) => Promise<Response> {
  return async (request: RouteRequest<TParams>) => {
    const id = parsePositiveIntParam(String(request.params[param]), String(param));
    const model = await resolver(id, request);
    return await handler(request, model);
  };
}

export { bindRouteModel };
