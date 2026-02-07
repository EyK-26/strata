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

export { BadRequestError, HttpError, NotFoundError };
