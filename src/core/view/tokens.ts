import { createServiceToken } from "@getstrata/core/contracts/token";
import type { EtaViewEngine } from "./etaViewEngine";
import type { ViewRenderer } from "./viewRenderer";

/** Canonical identity shared by built providers and every supported view export. */
const CORE_VIEW_RENDERER_TOKEN = createServiceToken<ViewRenderer>("core.viewRenderer");

const CORE_VIEW_TOKEN = createServiceToken<EtaViewEngine>("core.view");

export { CORE_VIEW_RENDERER_TOKEN, CORE_VIEW_TOKEN };
