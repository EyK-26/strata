import type { ViewRenderer } from "@getstrata/core/view/viewRenderer";
import type { BunRequest, Serve, Server } from "bun";
import type { ModuleRouteContext } from "../contracts";
import { recordM1Diagnostic } from "./diagnostics";
import { dataRecord, M1ConfigurationError } from "./validation";

type NativeHandler<Path extends string, Data> = Serve.Handler<
  BunRequest<Path>,
  Server<Data>,
  Response
>;
type Handler<Path extends string, Data> = NativeHandler<Path, Data>;
type Responder<Path extends string, Data> = Response | Handler<Path, Data>;
type Methods<Path extends string, Data> = {
  [M in Serve.HTTPMethod]: Readonly<Record<M, Responder<Path, Data>>> &
    Readonly<Partial<Record<Exclude<Serve.HTTPMethod, M>, Responder<Path, Data>>>>;
}[Serve.HTTPMethod];
export type GuardedRoute<Path extends string = string, Data = unknown> =
  | Responder<Path, Data>
  | Methods<Path, Data>;
export type GuardedRouteMap<Data = unknown> = {
  readonly [path: string]: GuardedRoute<string, Data>;
};
declare const preparedRouteData: unique symbol;
/** Type-only proof produced by the checked helper; there is no caller-forgeable runtime marker. */
export type PreparedApplicationRoutes<Data = unknown> = {
  readonly [preparedRouteData]: (data: Data) => Data;
};
export type ApplicationRoutes<Data, Paths extends string> = PreparedApplicationRoutes<Data> & {
  readonly [Path in Paths]: Methods<Path, Data>;
};
type NormalizedRoutes = Readonly<Record<string, Methods<string, unknown>>>;
// Only our immutable, checked method maps enter this set. SDK Response bodies remain mutable.
const preparedMaps = new WeakSet<object>();
export type DocumentRenderer = Pick<ViewRenderer, "render" | "renderHtmx">;
export type ApiRouteContext = ModuleRouteContext & { readonly documents?: DocumentRenderer };
export type WebRouteContext = ModuleRouteContext & { readonly documents: DocumentRenderer };
export const HTTP_METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const;

export function routeShape(path: string): string {
  if (!path.startsWith("/") || /[^\x21-\x7e]|[?#%\\]/.test(path))
    throw new M1ConfigurationError("invalid-route-path", "path");
  const segments = path.slice(1).split("/");
  const parameters = new Set<string>();
  return `/${segments
    .map((part, index) => {
      if (!part && (path === "/" || index === segments.length - 1)) return part;
      if (part === "*" && index === segments.length - 1) return part;
      if (part.startsWith(":")) {
        const name = part.slice(1);
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || parameters.has(name))
          throw new M1ConfigurationError("invalid-parameter", "path");
        parameters.add(name);
        return ":";
      }
      if (!/^[A-Za-z0-9._~-]+$/.test(part) || part === "." || part === "..")
        throw new M1ConfigurationError("invalid-route-segment", "path");
      return part;
    })
    .join("/")}`;
}

function assertReusableResponse(value: Response, owner: string): void {
  if (value.bodyUsed) throw new M1ConfigurationError("consumed-response", "routes", owner);
  if (value.body?.locked) throw new M1ConfigurationError("uncloneable-response", "routes", owner);
}

function routeRecord(value: unknown, field: string, owner: string): Record<string, unknown> {
  try {
    return dataRecord(value, field);
  } catch (error) {
    recordM1Diagnostic(error, { stage: "validation", code: "invalid-record", field, owner });
    throw error;
  }
}

export function validateGuardedRoutes(value: unknown, owner: string): NormalizedRoutes {
  if (value && typeof value === "object" && preparedMaps.has(value)) {
    const prepared = value as NormalizedRoutes;
    for (const methods of Object.values(prepared))
      for (const handler of Object.values(methods))
        if (handler instanceof Response) assertReusableResponse(handler, owner);
    return prepared;
  }
  const input = routeRecord(value, "routes", owner);
  const routes: Record<string, Methods<string, unknown>> = Object.create(null);
  function responder(value: unknown): Responder<string, unknown> {
    if (value instanceof Response) {
      assertReusableResponse(value, owner);
      return value;
    }
    if (typeof value !== "function")
      throw new M1ConfigurationError("invalid-handler", "routes", owner);
    return async (request, server) => {
      const response: unknown = await value(request, server);
      if (!(response instanceof Response))
        throw new M1ConfigurationError("invalid-handler-return", "routes", owner, "request");
      return response;
    };
  }
  for (const [path, declaration] of Object.entries(input)) {
    routeShape(path);
    const methods: Record<string, Responder<string, unknown>> = Object.create(null);
    if (declaration instanceof Response) {
      for (const method of HTTP_METHODS.filter((method) => method !== "OPTIONS"))
        methods[method] = responder(declaration);
    } else if (typeof declaration === "function") methods.GET = responder(declaration);
    else {
      const supplied = routeRecord(declaration, "methods", owner);
      if (!Object.keys(supplied).length)
        throw new M1ConfigurationError("empty-method-map", "routes", owner);
      for (const [method, handler] of Object.entries(supplied)) {
        if (!(HTTP_METHODS as readonly string[]).includes(method))
          throw new M1ConfigurationError("invalid-method", "routes", owner);
        methods[method] = responder(handler);
      }
    }
    routes[path] = Object.freeze(methods) as Methods<string, unknown>;
  }
  const prepared = Object.freeze(routes);
  preparedMaps.add(prepared);
  return prepared;
}

export function defineApplicationRoutes<Data = unknown>() {
  return <const Paths extends `/${string}`>(
    routes: { readonly [Path in Paths]: GuardedRoute<Path, Data> },
  ): ApplicationRoutes<Data, Paths> =>
    validateGuardedRoutes(routes, "application") as unknown as ApplicationRoutes<Data, Paths>;
}
