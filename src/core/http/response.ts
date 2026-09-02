import { toHttpError } from "@getstrata/core/errors/http";
import { mapDatabaseError } from "../database/errors";
import { webErrorResponse } from "./webErrorResponse";

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
  const mappedError = toHttpError(error) ?? mapDatabaseError(error);

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
      const webResponse = await webErrorResponse(error, request);

      if (webResponse) {
        return webResponse;
      }

      return errorResponse(error);
    }
  };
}

export { createdResponse, errorResponse, jsonResponse, noContentResponse, withErrorHandling };
