import { BadRequestError, HttpError } from "../errors/http";
export { serializeDate, toResourceCollection } from "./resources";
export {
  buildRequestCacheKey,
  expectObject,
  getQueryParams,
  parseJsonBody,
  parseOptionalBooleanQueryParam,
  parseOptionalEnumQueryParam,
  parseOptionalPositiveIntQueryParam,
} from "./validation";

function jsonResponse(data: unknown, init: ResponseInit = {}): Response {
  return Response.json(data, {
    status: init.status ?? 200,
    headers: init.headers,
  });
}

function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) {
    return Response.json(
      {
        error: error.message,
        ...(error.details === undefined ? {} : { details: error.details }),
      },
      { status: error.status },
    );
  }

  console.error(error);

  return Response.json({ error: "Internal Server Error" }, { status: 500 });
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

function parsePositiveIntParam(value: string, name: string = "id"): number {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new BadRequestError(`Invalid ${name}. Expected a positive integer.`);
  }

  return parsed;
}

export {
  errorResponse,
  jsonResponse,
  parsePositiveIntParam,
  withErrorHandling,
};
