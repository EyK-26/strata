import { createServiceToken } from "@getstrata/core/contracts/token";
import type { ViewRenderer } from "./viewRenderer";

/** Canonical identity shared by built providers and every supported view export. */
const CORE_VIEW_RENDERER_TOKEN = createServiceToken<ViewRenderer>("core.viewRenderer");

export { CORE_VIEW_RENDERER_TOKEN };
