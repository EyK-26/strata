import { resolve } from "node:path";
import { csrfTokenOptionsFromEnvironment } from "@getstrata/core/http/csrfToken";
import { flashSessionOptionsFromEnvironment } from "@getstrata/core/http/flashSession";
import { isViewsMode, parseFrontendMode } from "@getstrata/core/runtime/frontendMode";
import type { WebErrorViewOptions, WebLayoutDataOptions } from "@getstrata/core/view";
import {
  createWebErrorView,
  createWebLayoutDataResolver,
  EtaViewEngine,
  errorTemplateName,
  ViewRenderer,
} from "@getstrata/core/view";
import {
  CORE_VIEW_RENDERER_TOKEN,
  CORE_VIEW_TOKEN,
  CORE_WEB_ERROR_VIEW_TOKEN,
} from "@getstrata/core/view/tokens";
import type { ServiceProvider } from "../contracts";

const VIEW_DIRECTORY_CONFIG_KEY = "view.directory";

interface ViewProviderOptions {
  env?: Readonly<Record<string, string | undefined>>;
  /** Explicit document capability, for example a browser SSO continuation in an API app. */
  enabled?: boolean;
  /** Relative directories are resolved against this root at provider construction. */
  rootDir?: string;
  directory?: string;
  layout?: string | false;
  data?: WebLayoutDataOptions;
  error?: WebErrorViewOptions;
}

/** Captures configuration and paths once, before registration or request execution. */
function createViewProvider(options: ViewProviderOptions = {}): ServiceProvider {
  const env = { ...(options.env ?? process.env) };
  const enabled = options.enabled ?? isViewsMode(parseFrontendMode(env.FRONTEND_MODE));
  const directory = resolve(
    options.rootDir ?? process.cwd(),
    options.directory ?? (env.VIEW_DIRECTORY?.trim() || "resources/views"),
  );
  const layout = options.layout;
  const appName = env.APP_NAME?.trim() || "Strata";
  const extra = options.data?.extra;
  const defaults = { appName, currentOrganization: null, organizations: [] };
  const data = {
    ...options.data,
    csrf: options.data?.csrf
      ? { ...options.data.csrf }
      : enabled
        ? csrfTokenOptionsFromEnvironment(env)
        : undefined,
    flash: options.data?.flash
      ? { ...options.data.flash }
      : enabled
        ? flashSessionOptionsFromEnvironment(env)
        : undefined,
    extra:
      typeof extra === "function"
        ? async (user: Record<string, unknown> | null) => ({ ...defaults, ...(await extra(user)) })
        : { ...defaults, ...extra },
  };
  const customErrorRender = options.error?.render;
  return {
    name: "view",
    register({ container, config }) {
      if (!enabled) return;
      config.set(VIEW_DIRECTORY_CONFIG_KEY, directory);
      const engine = new EtaViewEngine(directory, createWebLayoutDataResolver(container, data));
      container.set(CORE_VIEW_TOKEN, engine);
      container.set(CORE_VIEW_RENDERER_TOKEN, new ViewRenderer(engine, layout));
      container.set(
        CORE_WEB_ERROR_VIEW_TOKEN,
        createWebErrorView({
          render:
            customErrorRender ??
            ((input) =>
              engine.render(
                errorTemplateName(input.status),
                {
                  title: input.title,
                  message: input.message,
                  errors: input.errors,
                },
                { layout, request: input.request },
              )),
        }),
      );
    },
  };
}

export type { ViewProviderOptions };
export { CORE_VIEW_TOKEN, createViewProvider, VIEW_DIRECTORY_CONFIG_KEY };
