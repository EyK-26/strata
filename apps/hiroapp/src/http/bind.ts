import { toRouteRequest } from "@getstrata/bootstrap/web/routing";
import type { RouteRequest } from "@getstrata/core/http/route";
import { bindRouteModel } from "@getstrata/core/http/routeModelBinding";

export function bindModel<TModel>(
  param: string,
  resolver: (id: number, request: RouteRequest<Record<string, string>>) => Promise<TModel>,
  handler: (
    request: RouteRequest<Record<string, string>>,
    model: TModel,
  ) => Response | Promise<Response>,
) {
  const bound = bindRouteModel(param, resolver, handler);
  return (request: Request) => bound(toRouteRequest(request));
}
