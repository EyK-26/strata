import { currentAuthUser } from "@getstrata/core/auth/authContext";
import type { Policy } from "@getstrata/core/auth/policy";
import { BadRequestError, NotFoundError } from "@getstrata/core/errors/http";
import {
  resolveApplicationAuth,
  resolveApplicationPolicyGate,
} from "@getstrata/core/runtime/applicationRegistry";
import {
  applyConditionalGet,
  assertIfMatch,
  type EtagVersioned,
  etagFromResource,
  isEtagEnabled,
} from "./etag";
import type { RouteRequest } from "./route";
import { parsePositiveIntParam } from "./validation";

interface RouteModelAuthorization {
  resource: string;
  action: keyof Policy;
  requireIfMatch?: boolean;
  /** Opt in (`true`) or out (`false`) of GET ETags. HTML and composites are off by default. */
  etag?: boolean;
}

function isMutatingPolicyAction(action: keyof Policy): boolean {
  return action === "update" || action === "delete";
}

function modelHasIdentity(model: unknown): boolean {
  return (
    !!model &&
    typeof model === "object" &&
    "id" in model &&
    (model as { id?: unknown }).id !== undefined &&
    (model as { id?: unknown }).id !== null
  );
}

function shouldApplyViewEtag(
  response: Response,
  model: unknown,
  authorization: RouteModelAuthorization,
): boolean {
  if (authorization.etag === false) {
    return false;
  }

  if (authorization.etag === true) {
    return true;
  }

  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.includes("text/html")) {
    return false;
  }

  return modelHasIdentity(model);
}

function requireResolvedModel<TModel>(model: TModel | null | undefined): TModel {
  if (model == null) {
    throw new NotFoundError();
  }

  return model;
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
    const model = requireResolvedModel(await resolver(id, request));
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

    if (
      isEtagEnabled() &&
      authorization.action === "view" &&
      shouldApplyViewEtag(response, model, authorization)
    ) {
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

    const model = requireResolvedModel(await resolver(key, request));
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

    if (
      isEtagEnabled() &&
      authorization.action === "view" &&
      shouldApplyViewEtag(response, model, authorization)
    ) {
      return applyConditionalGet(request, response, etagFromResource(model as EtagVersioned));
    }

    return response;
  };
}

export type { RouteModelAuthorization };
export { securedBindRouteModel, securedBindRouteModelByKey };
