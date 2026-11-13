import { toHttpError } from "@getstrata/core/errors/http";
import {
  logServerError,
  type WebErrorResponseOptions,
  webErrorResponse,
} from "@getstrata/core/http/webErrorResponse";
import { mapDatabaseHttpError } from "./databaseError";
import type { Middleware } from "./middleware";
import { currentRequestMeta, runWithRequestMeta } from "./requestMetaContext";

function jsonResponse(data: unknown, init: ResponseInit = {}): Response {
  return Response.json(data, {
    status: init.status ?? 200,
    headers: init.headers,
  });
}

/** Explicit private payloads (identity, credentials and CSRF); public JSON defaults stay unchanged. */
function privateJsonResponse(data: unknown, init: ResponseInit = {}): Response {
  const response = jsonResponse(data, init);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

function createdResponse(data: unknown, init: ResponseInit = {}): Response {
  return jsonResponse(data, { ...init, status: init.status ?? 201 });
}

function noContentResponse(): Response {
  return new Response(null, { status: 204 });
}

function errorResponse(error: unknown): Response {
  const mappedError = toHttpError(error) ?? mapDatabaseHttpError(error);
  logServerError(error, mappedError);

  return Response.json(
    {
      error: mappedError.message,
      ...(mappedError.details === undefined ? {} : { details: mappedError.details }),
    },
    { status: mappedError.status, headers: { "Cache-Control": "no-store" } },
  );
}

function withErrorHandling<THandler extends (request: Request) => Response | Promise<Response>>(
  handler: THandler,
  options?: WebErrorResponseOptions,
): (...args: Parameters<THandler>) => Promise<Response>;
function withErrorHandling<TArgs extends unknown[]>(
  handler: (...args: TArgs) => Response | Promise<Response>,
  options?: WebErrorResponseOptions,
): (...args: TArgs) => Promise<Response>;
function withErrorHandling<TArgs extends unknown[]>(
  handler: (...args: TArgs) => Response | Promise<Response>,
  options: WebErrorResponseOptions = {},
): (...args: TArgs) => Promise<Response> {
  const captured = { ...options };
  return async (...args: TArgs): Promise<Response> => {
    try {
      return await handler(...args);
    } catch (error) {
      const request = args.find((arg): arg is Request => arg instanceof Request);
      const webResponse = await webErrorResponse(error, request, captured);

      if (webResponse) {
        return webResponse;
      }

      return errorResponse(error);
    }
  };
}

function withJsonErrorHandling<THandler extends (request: Request) => Response | Promise<Response>>(
  handler: THandler,
): (...args: Parameters<THandler>) => Promise<Response>;
function withJsonErrorHandling<TArgs extends unknown[]>(
  handler: (...args: TArgs) => Response | Promise<Response>,
): (...args: TArgs) => Promise<Response>;
function withJsonErrorHandling<TArgs extends unknown[]>(
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

function createJsonErrorMiddleware(): Middleware {
  return async (_request, next) =>
    await runWithRequestMeta({ ...currentRequestMeta(), errorFormat: "json" }, async () => {
      try {
        return await next();
      } catch (error) {
        return errorResponse(error);
      }
    });
}

function createWebErrorMiddleware(options: WebErrorResponseOptions = {}): Middleware {
  const captured = { ...options };
  return async (request, next) =>
    await runWithRequestMeta(
      {
        ...currentRequestMeta(),
        webErrorView: captured.render,
        viewsEnabled: captured.enabled ?? false,
        webErrorsProduction: captured.production ?? true,
      },
      () => withErrorHandling(async (_request: Request) => next(), captured)(request),
    );
}

export {
  createdResponse,
  createJsonErrorMiddleware,
  createWebErrorMiddleware,
  errorResponse,
  jsonResponse,
  noContentResponse,
  privateJsonResponse,
  withErrorHandling,
  withJsonErrorHandling,
};
