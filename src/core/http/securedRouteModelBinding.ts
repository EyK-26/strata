import {
  resolveApplicationAuth,
  resolveApplicationPolicyGate,
} from "../../bootstrap/applicationRegistry";
import type { Policy } from "../auth/policy";
import { parsePositiveIntParam } from "./validation";
import type { RouteRequest } from "./route";

interface RouteModelAuthorization {
  resource: string;
  action: keyof Policy;
}

function securedBindRouteModel<
  TParams extends Record<string, string>,
  TModel,
  TParam extends keyof TParams & string,
>(
  param: TParam,
  resolver: (id: number, request: RouteRequest<TParams>) => Promise<TModel>,
  authorization: RouteModelAuthorization,
  handler: (
    request: RouteRequest<TParams>,
    model: TModel,
  ) => Response | Promise<Response>,
): (request: RouteRequest<TParams>) => Promise<Response> {
  return async (request: RouteRequest<TParams>) => {
    const id = parsePositiveIntParam(String(request.params[param]), String(param));
    const model = await resolver(id, request);
    const gate = resolveApplicationPolicyGate();
    const auth = resolveApplicationAuth();

    gate.authorize(
      authorization.resource,
      authorization.action,
      auth.resolve(request),
      model,
    );

    return await handler(request, model);
  };
}

export { securedBindRouteModel };
export type { RouteModelAuthorization };
