import { composeMiddleware, type Middleware, type RouteHandler } from "./middleware";

function withMiddleware(...middleware: Middleware[]): (handler: RouteHandler) => RouteHandler {
  const wrap = composeMiddleware(...middleware);

  return (handler: RouteHandler): RouteHandler => {
    return wrap(handler);
  };
}

export { withMiddleware };
