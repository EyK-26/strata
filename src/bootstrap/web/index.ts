/**
 * Web-focused bootstrap utilities for HTML and cookie-session apps.
 */

export { createCsrfProtection, type ParsedForm, parseFormBody } from "./forms.ts";
export {
  createRouteKernel,
  routeParams,
  toRouteRequest,
  wrapSecuredRouteModelByKey,
  wrapWebLogin,
  wrapWebRegister,
} from "./routing.ts";
export { convertAppRoutesToBunRoutes, createWebServer, type WebServerOptions } from "./server.ts";
export {
  CookieSessionAuthManager,
  CookieSessionGuard,
  CookieSessionStore,
  createCookieSessionAuthManager,
  type LoadSessionUser,
  type MapSessionUser,
  type SessionUser,
} from "./session.ts";
export { slugify } from "./slug.ts";
