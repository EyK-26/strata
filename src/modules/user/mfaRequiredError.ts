import { UnauthorizedError } from "@getstrata/core/errors/http";

class MfaRequiredError extends UnauthorizedError {
  readonly userId: number;

  constructor(userId: number) {
    super("Two-factor authentication required.");
    this.userId = userId;
  }
}

export { MfaRequiredError };
