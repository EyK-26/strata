import { currentAuthUser } from "../../core/auth/authContext";
import type { Policy } from "../../core/auth/policy";
import { BadRequestError } from "../../core/errors/http";
import {
  applyConditionalGet,
  assertIfMatch,
  type EtagVersioned,
  etagFromResource,
  isEtagEnabled,
} from "../../core/http/etag";
import type { RouteRequest } from "../../core/http/route";
import { parsePositiveIntParam } from "../../core/http/validation";
import { resolveApplicationAuth, resolveApplicationPolicyGate } from "../applicationRegistry";

interface RouteModelAuthorization {
  resource: string;
  action: keyof Policy;
  requireIfMatch?: boolean;
}

function isMutatingPolicyAction(action: keyof Policy): boolean {
  return action === "update" || action === "delete";
}

function securedBindRouteModel<
  TParams extends Record<string, string>,
  TModel,
  TParam extends keyof TParams & string,
>(
  param: TParam,
  resolver: (id: number, request: RouteRequest<TParams>) => Promise<TModel>,
  authorization: RouteModelAuthorization,
  handler: (request: RouteRequest<TParams>, model: TModel) => Response | Promise<Response>,
): (request: RouteRequest<TParams>) => Promise<Response> {
  return async (request: RouteRequest<TParams>) => {
    const id = parsePositiveIntParam(String(request.params[param]), String(param));
    const model = await resolver(id, request);
    const gate = resolveApplicationPolicyGate();
    const auth = resolveApplicationAuth();
    const user = currentAuthUser() ?? (await auth.resolve(request));

    gate.authorize(authorization.resource, authorization.action, user, model);

    if (isEtagEnabled() && isMutatingPolicyAction(authorization.action)) {
      assertIfMatch(request, etagFromResource(model as EtagVersioned), {
        required: authorization.requireIfMatch ?? true,
      });
    }

    const response = await handler(request, model);

    if (isEtagEnabled() && authorization.action === "view") {
      return applyConditionalGet(request, response, etagFromResource(model as EtagVersioned));
    }

    return response;
  };
}

function securedBindRouteModelByKey<
  TParams extends Record<string, string>,
  TModel,
  TParam extends keyof TParams & string,
>(
  param: TParam,
  resolver: (key: string, request: RouteRequest<TParams>) => Promise<TModel>,
  authorization: RouteModelAuthorization,
  handler: (request: RouteRequest<TParams>, model: TModel) => Response | Promise<Response>,
): (request: RouteRequest<TParams>) => Promise<Response> {
  return async (request: RouteRequest<TParams>) => {
    const key = String(request.params[param] ?? "").trim();
    if (!key) {
      throw new BadRequestError(`Missing route parameter "${String(param)}".`);
    }

    const model = await resolver(key, request);
    const gate = resolveApplicationPolicyGate();
    const auth = resolveApplicationAuth();
    const user = currentAuthUser() ?? (await auth.resolve(request));

    gate.authorize(authorization.resource, authorization.action, user, model);

    if (isEtagEnabled() && isMutatingPolicyAction(authorization.action)) {
      assertIfMatch(request, etagFromResource(model as EtagVersioned), {
        required: authorization.requireIfMatch ?? true,
      });
    }

    const response = await handler(request, model);

    if (isEtagEnabled() && authorization.action === "view") {
      return applyConditionalGet(request, response, etagFromResource(model as EtagVersioned));
    }

    return response;
  };
}

export type { RouteModelAuthorization };
export { securedBindRouteModel, securedBindRouteModelByKey };
