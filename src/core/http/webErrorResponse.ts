import { HttpError, UnauthorizedError, ValidationError } from "@getstrata/core/errors/http";
import { mapDatabaseError } from "../database/errors";
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
  if (status >= 500 && process.env.NODE_ENV === "production") {
    return "Something went wrong.";
  }

  return message;
}

async function webErrorResponse(error: unknown, request?: Request): Promise<Response | null> {
  if (!request || !isViewsEnabled() || requestPrefersJson(request)) {
    return null;
  }

  const mappedError = error instanceof HttpError ? error : mapDatabaseError(error);

  if (mappedError instanceof UnauthorizedError) {
    return Response.redirect(loginRedirectLocation(request), 302);
  }

  const errors =
    mappedError instanceof ValidationError ? normalizeFieldErrors(mappedError.details) : undefined;

  return htmlErrorResponse({
    status: mappedError.status,
    title: errorPageTitle(mappedError.status, mappedError.message),
    message: publicErrorMessage(mappedError.status, mappedError.message),
    errors,
    request,
  });
}

export type { FieldErrors };
export { normalizeFieldErrors, webErrorResponse };
