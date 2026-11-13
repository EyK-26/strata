import { createServiceToken } from "@getstrata/core/contracts/token";
import type { Middleware } from "@getstrata/core/http/middleware";
import type {
  BusinessRequestPorts,
  BusinessRouteHandler,
  HttpPersistenceOptions,
  IdentityPolicyMode,
} from "./persistenceContracts";

export const HTTP_PERSISTENCE_OPTIONS = createServiceToken<HttpPersistenceOptions>(
  "bootstrap.httpPersistence",
);

export interface ComposedRouteHandler<T extends Request = Request> {
  (request: T): Response | Promise<Response>;
  (request: T, ports: BusinessRequestPorts): Response | Promise<Response>;
  <TData>(request: T, server: Bun.Server<TData>): Response | Promise<Response>;
}

// biome-ignore lint/suspicious/noConfusingVoidType: request hooks may return no interception.
type Interception = Response | void;

/** Reject malformed JavaScript handlers before metadata inspection or wrapper effects. */
export function assertHttpHandler(
  handler: unknown,
): asserts handler is (...args: never[]) => unknown {
  if (typeof handler !== "function") throw new TypeError("HTTP route handler must be a function.");
}

const portsBrand: unique symbol = Symbol("http.business.ports");
const scimPolicy: unique symbol = Symbol("http.scim.policy");
export function scimMiddleware(handler: unknown): readonly Middleware[] | undefined {
  assertHttpHandler(handler);
  return Object.getOwnPropertyDescriptor(handler, scimPolicy)?.value;
}
const identityPolicy: unique symbol = Symbol("http.identity.policy");
export function identityModes(handler: unknown): readonly IdentityPolicyMode[] | undefined {
  assertHttpHandler(handler);
  return Object.getOwnPropertyDescriptor(handler, identityPolicy)?.value;
}
const routeDispatch: unique symbol = Symbol("http.owned.route");
export function businessPorts(value: BusinessRequestPorts): BusinessRequestPorts {
  return Object.freeze(Object.defineProperty(value, portsBrand, { value }));
}
export function isBusinessPorts(value: unknown): value is BusinessRequestPorts {
  return (
    !!value &&
    typeof value === "object" &&
    Object.getOwnPropertyDescriptor(value, portsBrand)?.value === value
  );
}
export function ownedHttpRoute<T extends Request>(
  handler: BusinessRouteHandler<T>,
  enter: (request: T, handler: BusinessRouteHandler<T>) => Promise<Response>,
  modes?: readonly IdentityPolicyMode[],
  scim?: readonly Middleware[],
): ComposedRouteHandler<T> {
  assertHttpHandler(handler);
  assertHttpHandler(enter);
  const dispatch = (
    request: T,
    before?: (ports: BusinessRequestPorts) => Interception | Promise<Interception>,
  ) =>
    enter(request, async (req, ports) => {
      const intercepted = await before?.(ports);
      return intercepted instanceof Response ? intercepted : handler(req, ports);
    });
  const route = (request: T, ports?: unknown) =>
    isBusinessPorts(ports) ? handler(request, ports) : dispatch(request);
  return Object.assign(route, {
    [routeDispatch]: dispatch,
    ...(modes ? { [identityPolicy]: Object.freeze([...modes]) } : {}),
    ...(scim ? { [scimPolicy]: Object.freeze([...scim]) } : {}),
  });
}
export async function dispatchOwnedRoute(
  handler: unknown,
  request: Request,
  before: (ports: BusinessRequestPorts) => Interception | Promise<Interception>,
): Promise<Response | undefined> {
  if (typeof handler !== "function") return undefined;
  const dispatch = Object.getOwnPropertyDescriptor(handler, routeDispatch)?.value;
  return typeof dispatch === "function" ? dispatch(request, before) : undefined;
}

/** Pure public/operational response policy; persistence probes enter their own explicit invocations. */
export function ownedPublicHttpRoute<T extends Request>(
  handler: (request: T) => Response | Promise<Response>,
  enter: (request: T, work: (request: T) => Response | Promise<Response>) => Promise<Response>,
) {
  assertHttpHandler(handler);
  assertHttpHandler(enter);
  const dispatch = (request: T, before?: () => Interception | Promise<Interception>) =>
    enter(request, async (req) => {
      const intercepted = await before?.();
      return intercepted instanceof Response ? intercepted : handler(req);
    });
  return Object.assign((request: T) => dispatch(request), { [routeDispatch]: dispatch });
}
