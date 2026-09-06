import { type HttpError, toHttpError, ValidationError } from "@getstrata/core/errors/http";
import { appLogger } from "@getstrata/core/logging/logger";
import { mapDatabaseError } from "../database/errors";
import { isProductionEnv } from "../runtime/appEnv";
import { isViewsEnabled } from "../runtime/frontendMode";
import { htmlErrorResponse } from "../view/webErrorView";
import { requestPrefersJson } from "./contentNegotiation";
import { loginRedirectLocation } from "./safeInternalPath";

type FieldErrors = Record<string, string[]>;

function normalizeFieldErrors(details: unknown): FieldErrors {
  if (!details || typeof details !== "object" || Array.isArray(details)) {
    return {};
  }

  const errors: FieldErrors = {};

  for (const [field, messages] of Object.entries(details as Record<string, unknown>)) {
    if (Array.isArray(messages)) {
      errors[field] = messages.map(String);
      continue;
    }

    if (typeof messages === "string") {
      errors[field] = [messages];
    }
  }

  return errors;
}

function errorPageTitle(status: number, message: string): string {
  if (status === 404) {
    return "Not Found";
  }

  if (status === 403) {
    return "Forbidden";
  }

  if (status >= 500) {
    return "Server Error";
  }

  return message;
}

function publicErrorMessage(status: number, message: string): string {
  if (status >= 500 && isProductionEnv()) {
    return "Something went wrong.";
  }

  return message;
}

function logServerError(error: unknown, mappedError: HttpError): void {
  if (mappedError.status < 500) {
    return;
  }
  appLogger.error("Unhandled request error", {
    status: mappedError.status,
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
}

async function webErrorResponse(error: unknown, request?: Request): Promise<Response | null> {
  if (!request || !isViewsEnabled() || requestPrefersJson(request)) {
    return null;
  }

  const mappedError = toHttpError(error) ?? mapDatabaseError(error);
  logServerError(error, mappedError);

  if (mappedError.status === 401) {
    return Response.redirect(loginRedirectLocation(request), 302);
  }

  const errors =
    mappedError instanceof ValidationError || mappedError.name === "ValidationError"
      ? normalizeFieldErrors(mappedError.details)
      : undefined;

  return htmlErrorResponse({
    status: mappedError.status,
    title: errorPageTitle(mappedError.status, mappedError.message),
    message: publicErrorMessage(mappedError.status, mappedError.message),
    errors,
    request,
  });
}

export type { FieldErrors };
export { logServerError, normalizeFieldErrors, webErrorResponse };
