import { HttpError } from "../errors/http";
import { mapDatabaseError } from "../database/errors";
export { BadRequestError, ConflictError, ForbiddenError, HttpError, NotFoundError, UnauthorizedError, UnprocessableEntityError, ValidationError } from "../errors/http";
export { serializeDate, toPaginatedResourceCollection, toResourceCollection } from "./resources";
export {
  buildPaginationMeta,
  DEFAULT_PER_PAGE,
  MAX_PER_PAGE,
  paginatedResponse,
  parsePaginationQuery,
} from "./pagination";
export type { PaginatedResult, PaginationMeta } from "../pagination";
export {
  applyMiddlewareToRoutes,
  composeMiddleware,
  requestIdMiddleware,
  wrapRouteHandler,
} from "./middleware";
export type { Middleware, RouteHandler } from "./middleware";
export { FormRequest, QueryFormRequest } from "./formRequest";
export { bindRouteModel } from "./routeModelBinding";
export { securedBindRouteModel } from "./securedRouteModelBinding";
export { createAuthMiddleware } from "./authMiddleware";
export { createAuthorizeMiddleware } from "./authorizeMiddleware";
export { createRequireAuthMiddleware } from "./requireAuthMiddleware";
export { withMiddleware } from "./routeMiddleware";
export {
  applyRouteMiddleware,
  resolveRouteMiddleware,
} from "./routeMiddlewareGroups";
export {
  buildRequestCacheKey,
  expectObject,
  getQueryParams,
  parseJsonBody,
  parseOptionalBooleanQueryParam,
  parseOptionalEnumQueryParam,
  parseOptionalPositiveIntQueryParam,
  parsePositiveIntParam,
  readOptionalEnum,
  readOptionalPositiveInt,
  readOptionalString,
  readRequiredEnum,
  readRequiredPositiveInt,
  readRequiredString,
} from "./validation";

function jsonResponse(data: unknown, init: ResponseInit = {}): Response {
  return Response.json(data, {
    status: init.status ?? 200,
    headers: init.headers,
  });
}

function createdResponse(data: unknown, init: ResponseInit = {}): Response {
  return jsonResponse(data, { ...init, status: init.status ?? 201 });
}

function noContentResponse(): Response {
  return new Response(null, { status: 204 });
}

function errorResponse(error: unknown): Response {
  const mappedError =
    error instanceof HttpError ? error : mapDatabaseError(error);

  return Response.json(
    {
      error: mappedError.message,
      ...(mappedError.details === undefined
        ? {}
        : { details: mappedError.details }),
    },
    { status: mappedError.status },
  );
}

function withErrorHandling<TArgs extends unknown[]>(
  handler: (...args: TArgs) => Response | Promise<Response>,
): (...args: TArgs) => Promise<Response> {
  return async (...args: TArgs): Promise<Response> => {
    try {
      return await handler(...args);
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export { getRouteParams } from "./route";
export type { RouteRequest } from "./route";
export {
  createdResponse,
  errorResponse,
  jsonResponse,
  noContentResponse,
  withErrorHandling,
};
