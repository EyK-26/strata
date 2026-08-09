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
};
