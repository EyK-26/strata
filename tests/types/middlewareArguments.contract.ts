import { composeMiddleware, type RouteHandler } from "@getstrata/core/http/middleware";

function contracts(request: Request, server: { port: number }) {
  const single: RouteHandler = () => new Response("single");
  const singleWrapped = composeMiddleware()(single);
  singleWrapped(request);
  // @ts-expect-error Legacy one-argument handlers do not gain arbitrary arguments.
  singleWrapped(request, server);

  const required = composeMiddleware()(
    (request: Request, native: { port: number }) =>
      new Response(`${request.method}:${native.port}`),
  );
  required(request, server);
  // @ts-expect-error Required native callback arguments remain required.
  required(request);
  // @ts-expect-error Native callback argument types are not erased to unknown.
  required(request, { port: "invalid" });
  return required;
}

void contracts;
