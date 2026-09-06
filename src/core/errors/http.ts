class HttpError extends Error {
  readonly status: number;
  readonly details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = new.target.name;
    this.status = status;
    this.details = details;
  }
}

class BadRequestError extends HttpError {
  constructor(message: string = "Bad Request", details?: unknown) {
    super(400, message, details);
  }
}

class NotFoundError extends HttpError {
  constructor(message: string = "Not Found", details?: unknown) {
    super(404, message, details);
  }
}

class ConflictError extends HttpError {
  constructor(message: string = "Conflict", details?: unknown) {
    super(409, message, details);
  }
}

class UnprocessableEntityError extends HttpError {
  constructor(message: string = "Unprocessable Entity", details?: unknown) {
    super(422, message, details);
  }
}

class ValidationError extends HttpError {
  constructor(message: string = "Validation failed", details?: unknown) {
    super(422, message, details);
  }
}

class ForbiddenError extends HttpError {
  constructor(message: string = "Forbidden", details?: unknown) {
    super(403, message, details);
  }
}

class UnauthorizedError extends HttpError {
  constructor(message: string = "Unauthorized", details?: unknown) {
    super(401, message, details);
  }
}

class PayloadTooLargeError extends HttpError {
  constructor(message: string = "Payload Too Large", details?: unknown) {
    super(413, message, details);
  }
}

class PreconditionFailedError extends HttpError {
  constructor(message: string = "Precondition Failed", details?: unknown) {
    super(412, message, details);
  }
}

class InternalServerError extends HttpError {
  constructor(message: string = "Internal server error.", details?: unknown) {
    super(500, message, details);
  }
}

interface HttpErrorLike {
  status: number;
  message: string;
  details?: unknown;
}

function isHttpErrorLike(error: unknown): error is HttpErrorLike {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const candidate = error as { status?: unknown; message?: unknown };

  return (
    typeof candidate.status === "number" &&
    Number.isInteger(candidate.status) &&
    candidate.status >= 400 &&
    candidate.status < 600 &&
    typeof candidate.message === "string"
  );
}

function toHttpError(error: unknown): HttpError | null {
  if (error instanceof HttpError) {
    return error;
  }

  if (!isHttpErrorLike(error)) {
    return null;
  }

  return new HttpError(error.status, error.message, error.details);
}

export {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  HttpError,
  InternalServerError,
  isHttpErrorLike,
  NotFoundError,
  PayloadTooLargeError,
  PreconditionFailedError,
  toHttpError,
  UnauthorizedError,
  UnprocessableEntityError,
  ValidationError,
};
