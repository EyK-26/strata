import { HttpError, UnauthorizedError, ValidationError } from "@getstrata/core/errors/http";
import { isViewsEnabled } from "../../config/frontend";
import { mapDatabaseError } from "../database/errors";
import { htmlResponse } from "../view";
import { requestPrefersJson } from "./contentNegotiation";

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

function webErrorResponse(error: unknown, request?: Request): Response | null {
  if (!request || !isViewsEnabled() || requestPrefersJson(request)) {
    return null;
  }

  const mappedError = error instanceof HttpError ? error : mapDatabaseError(error);

  if (mappedError instanceof UnauthorizedError) {
    const redirectTarget = encodeURIComponent(new URL(request.url).pathname);

    return Response.redirect(`/login?redirect=${redirectTarget}`, 302);
  }

  if (mappedError instanceof ValidationError) {
    const errors = normalizeFieldErrors(mappedError.details);
    const fieldSummary = Object.entries(errors)
      .flatMap(([field, messages]) => messages.map((message) => `${field}: ${message}`))
      .join("\n");

    return htmlResponse(
      `<section class="page-header"><h1>Validation failed</h1><pre>${fieldSummary || mappedError.message}</pre><p><a href="javascript:history.back()">Go back</a></p></section>`,
      { status: mappedError.status },
    );
  }

  return htmlResponse(`<section class="page-header"><h1>${mappedError.message}</h1></section>`, {
    status: mappedError.status,
  });
}

export type { FieldErrors };
export { normalizeFieldErrors, webErrorResponse };
