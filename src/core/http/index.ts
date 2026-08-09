import { mapDatabaseError } from "../database/errors";
import { HttpError } from "../errors/http";
import { webErrorResponse } from "./webErrorResponse";

export {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  HttpError,
  NotFoundError,
  PayloadTooLargeError,
  PreconditionFailedError,
  UnauthorizedError,
  UnprocessableEntityError,
  ValidationError,
} from "../errors/http";
export type { PaginatedResult, PaginationMeta } from "../pagination";
export { createAuthMiddleware } from "./authMiddleware";
export { createAuthorizeMiddleware } from "./authorizeMiddleware";
export { conditionalJsonResponse } from "./conditionalResponse";
export type { EtagVersioned } from "./etag";
export {
  applyConditionalGet,
  assertIfMatch,
  computeEtagFromJson,
  etagFromResource,
  etagValuesMatch,
  ifMatchSatisfied,
  ifNoneMatchSatisfied,
  isEtagEnabled,
  notModifiedResponse,
} from "./etag";
export { FormRequest, QueryFormRequest } from "./formRequest";
export type { Middleware, RouteHandler } from "./middleware";
export {
  applyMiddlewareToRoutes,
  composeMiddleware,
  requestIdMiddleware,
  wrapRouteHandler,
} from "./middleware";
export {
  buildPaginationMeta,
  DEFAULT_PER_PAGE,
  MAX_PER_PAGE,
  paginatedResponse,
  parsePaginationQuery,
} from "./pagination";
export { createRequireAuthMiddleware } from "./requireAuthMiddleware";
export { serializeDate, toPaginatedResourceCollection, toResourceCollection } from "./resources";
export { withMiddleware } from "./routeMiddleware";
export { bindRouteModel } from "./routeModelBinding";
export {
  securedBindRouteModel,
  securedBindRouteModelByKey,
} from "./securedRouteModelBinding";
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
  const mappedError = error instanceof HttpError ? error : mapDatabaseError(error);

  return Response.json(
    {
      error: mappedError.message,
      ...(mappedError.details === undefined ? {} : { details: mappedError.details }),
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
      const request = args.find((arg): arg is Request => arg instanceof Request);
      const webResponse = webErrorResponse(error, request);

      if (webResponse) {
        return webResponse;
      }

      return errorResponse(error);
    }
  };
}

export type { ParsedUpload } from "./parseMultipartUpload";
export { parseMultipartUpload, sanitizeUploadFileName } from "./parseMultipartUpload";
export type { RouteRequest } from "./route";
export { getRouteParams } from "./route";
export { createdResponse, errorResponse, jsonResponse, noContentResponse, withErrorHandling };
