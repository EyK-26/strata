export { CORE_VIEW_RENDERER_TOKEN } from "@getstrata/core/view/tokens";
export type { LayoutDataResolver, RenderOptions } from "./etaViewEngine";
export { DEFAULT_VIEWS_DIRECTORY, EtaViewEngine } from "./etaViewEngine";
export {
  htmlResponse,
  isHtmxRequest,
  redirectResponse,
  rssResponse,
  textResponse,
  xmlResponse,
} from "./htmlResponse";
export type { ViewEngine } from "./viewEngine";
export type {
  HtmxViewResponseOptions,
  NamespacedViewRenderer,
  ViewNamespaceOptions,
  ViewResponseOptions,
} from "./viewRenderer";
export { ViewRenderer } from "./viewRenderer";
export type { WebErrorViewInput, WebErrorViewOptions } from "./webErrorView";
export {
  configureWebErrorView,
  errorTemplateName,
  htmlErrorResponse,
  notFoundHtmlResponse,
  renderKernelErrorChrome,
  renderWebErrorHtml,
} from "./webErrorView";
export type {
  WebLayoutAuthUser,
  WebLayoutData,
  WebLayoutDataOptions,
  WebLayoutUserKey,
} from "./webLayoutData";
export {
  configureWebLayoutData,
  createWebLayoutDataResolver,
  resolveWebLayoutData,
} from "./webLayoutData";
