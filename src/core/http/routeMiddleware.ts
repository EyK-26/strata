import { composeMiddleware, type Middleware } from "./middleware";

/** Middleware consumes native Request; composition preserves the handler's request subtype. */
function withMiddleware(...middleware: Middleware[]) {
  return composeMiddleware(...middleware);
}

export { withMiddleware };
