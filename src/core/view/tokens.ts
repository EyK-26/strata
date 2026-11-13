import { createServiceToken } from "@getstrata/core/contracts/token";
import type { EtaViewEngine } from "./etaViewEngine";
import type { ViewRenderer } from "./viewRenderer";
import type { WebErrorView } from "./webErrorView";

/** Canonical identity shared by built providers and every supported view export. */
const CORE_VIEW_RENDERER_TOKEN = createServiceToken<ViewRenderer>("core.viewRenderer");

const CORE_VIEW_TOKEN = createServiceToken<EtaViewEngine>("core.view");

const CORE_WEB_ERROR_VIEW_TOKEN = createServiceToken<WebErrorView>("core.webErrorView");

export { CORE_VIEW_RENDERER_TOKEN, CORE_VIEW_TOKEN, CORE_WEB_ERROR_VIEW_TOKEN };
