/**
 * Web-focused bootstrap utilities for sibling apps (getstrata, marketing sites).
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
  CookieSessionGuard,
  CookieSessionStore,
  createCookieSessionAuthManager,
  type MapSessionUser,
  type SessionUser,
} from "./session.ts";
export { slugify } from "./slug.ts";
