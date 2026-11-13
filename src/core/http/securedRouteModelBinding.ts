import type { AuthUser } from "@getstrata/core/auth/authContext";
import type { AuthReader } from "@getstrata/core/auth/authReader";
import type { Policy } from "@getstrata/core/auth/policy";
import { BadRequestError, NotFoundError } from "@getstrata/core/errors/http";
import { applyConditionalGet, assertIfMatch, type EtagVersioned, etagFromResource } from "./etag";
import type { RouteRequest } from "./route";
import { parsePositiveIntParam } from "./validation";

interface RouteModelAuthorization {
  resource: string;
  action: keyof Policy;
  requireIfMatch?: boolean;
  /** Opt in (`true`) or out (`false`) of GET ETags. HTML and composites are off by default. */
  etag?: boolean;
}

interface RouteModelBindingPorts {
  readonly auth: Pick<AuthReader, "resolve">;
  readonly authorize: (
    resource: string,
    action: keyof Policy,
    user: AuthUser | null,
    model: unknown,
  ) => void | Promise<void>;
  readonly etagEnabled: boolean;
}

function snapshotPorts(ports: RouteModelBindingPorts): RouteModelBindingPorts {
  const auth = ports?.auth,
    resolve = auth?.resolve,
    authorize = ports?.authorize,
    etagEnabled = ports?.etagEnabled;
  if (
    typeof resolve !== "function" ||
    typeof authorize !== "function" ||
    typeof etagEnabled !== "boolean"
  )
    throw new TypeError(
      "Secured model binding requires explicit auth, authorization and ETag policy.",
    );
  return Object.freeze({
    auth: Object.freeze({ resolve: (request?: Request) => resolve.call(auth, request) }),
    authorize: (...args: Parameters<RouteModelBindingPorts["authorize"]>) =>
      authorize.call(ports, ...args),
    etagEnabled,
  });
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
  ports: RouteModelBindingPorts,
): (request: RouteRequest<TParams>) => Promise<Response> {
  const selected = snapshotPorts(ports);
  authorization = Object.freeze({ ...authorization });
  return async (request: RouteRequest<TParams>) => {
    const id = parsePositiveIntParam(String(request.params[param]), String(param));
    const model = requireResolvedModel(await resolver(id, request));
    const user = await selected.auth.resolve(request);
    await selected.authorize(authorization.resource, authorization.action, user, model);

    if (selected.etagEnabled && isMutatingPolicyAction(authorization.action)) {
      assertIfMatch(request, etagFromResource(model as EtagVersioned), {
        required: authorization.requireIfMatch ?? true,
      });
    }

    const response = await handler(request, model);

    if (
      selected.etagEnabled &&
      authorization.action === "view" &&
      shouldApplyViewEtag(response, model, authorization)
    ) {
      return applyConditionalGet(request, response, etagFromResource(model as EtagVersioned), {
        etagEnabled: selected.etagEnabled,
      });
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
  ports: RouteModelBindingPorts,
): (request: RouteRequest<TParams>) => Promise<Response> {
  const selected = snapshotPorts(ports);
  authorization = Object.freeze({ ...authorization });
  return async (request: RouteRequest<TParams>) => {
    const key = String(request.params[param] ?? "").trim();
    if (!key) {
      throw new BadRequestError(`Missing route parameter "${String(param)}".`);
    }

    const model = requireResolvedModel(await resolver(key, request));
    const user = await selected.auth.resolve(request);
    await selected.authorize(authorization.resource, authorization.action, user, model);

    if (selected.etagEnabled && isMutatingPolicyAction(authorization.action)) {
      assertIfMatch(request, etagFromResource(model as EtagVersioned), {
        required: authorization.requireIfMatch ?? true,
      });
    }

    const response = await handler(request, model);

    if (
      selected.etagEnabled &&
      authorization.action === "view" &&
      shouldApplyViewEtag(response, model, authorization)
    ) {
      return applyConditionalGet(request, response, etagFromResource(model as EtagVersioned), {
        etagEnabled: selected.etagEnabled,
      });
    }

    return response;
  };
}

export type { RouteModelAuthorization, RouteModelBindingPorts };
export { securedBindRouteModel, securedBindRouteModelByKey };
