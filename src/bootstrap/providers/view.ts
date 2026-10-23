import { currentRequestMeta } from "@getstrata/core/http/requestMetaContext";
import { appDisplayName } from "@getstrata/core/runtime/appKeyPrefix";
import { isViewsEnabled } from "@getstrata/core/runtime/frontendMode";
import type { WebLayoutDataOptions } from "@getstrata/core/view";
import {
  CORE_VIEW_RENDERER_TOKEN,
  configureWebErrorView,
  configureWebLayoutData,
  createWebLayoutDataResolver,
  DEFAULT_VIEWS_DIRECTORY,
  EtaViewEngine,
  errorTemplateName,
  resolveWebLayoutData,
  ViewRenderer,
} from "@getstrata/core/view";
import type { ServiceProvider } from "../contracts";

const CORE_VIEW_TOKEN = "core.view";
const VIEW_DIRECTORY_CONFIG_KEY = "view.directory";

interface ViewProviderOptions {
  /** Explicit document capability, for example a browser SSO continuation in an API app. */
  enabled?: boolean;
  directory?: string;
  layout?: string | false;
  data?: WebLayoutDataOptions;
}

/** Per-app view configuration for generated and custom bootstraps. */
function createViewProvider(options: ViewProviderOptions = {}): ServiceProvider {
  const directory = options.directory;
  const layout = options.layout;
  const data = { ...options.data };
  return {
    name: "view",
    register({ container, config }) {
      if (!(options.enabled ?? isViewsEnabled())) return;
      const viewsDirectory =
        directory ?? (process.env.VIEW_DIRECTORY?.trim() || DEFAULT_VIEWS_DIRECTORY);
      config.set(VIEW_DIRECTORY_CONFIG_KEY, viewsDirectory);
      const engine = new EtaViewEngine(
        viewsDirectory,
        createWebLayoutDataResolver(container, data),
      );
      container.set(CORE_VIEW_TOKEN, engine);
      container.set(CORE_VIEW_RENDERER_TOKEN, new ViewRenderer(engine, layout));
    },
  };
}

const viewProvider: ServiceProvider = {
  name: "view",

  register({ container, config }) {
    if (!isViewsEnabled()) {
      return;
    }

    const viewsDirectory = process.env.VIEW_DIRECTORY?.trim() || DEFAULT_VIEWS_DIRECTORY;
    config.set(VIEW_DIRECTORY_CONFIG_KEY, viewsDirectory);
    const engine = new EtaViewEngine(viewsDirectory, (request) =>
      resolveWebLayoutData(container, request ?? currentRequestMeta().request),
    );
    container.set(CORE_VIEW_TOKEN, engine);
    container.set(CORE_VIEW_RENDERER_TOKEN, new ViewRenderer(engine));
    configureWebLayoutData({
      extra: async () => ({
        appName: appDisplayName(),
        currentOrganization: null,
        organizations: [],
      }),
    });
    configureWebErrorView({
      render: async (input) =>
        engine.render(errorTemplateName(input.status), {
          title: input.title,
          message: input.message,
          errors: input.errors,
        }),
    });
  },
};

export type { ViewProviderOptions };
export { CORE_VIEW_TOKEN, createViewProvider, VIEW_DIRECTORY_CONFIG_KEY, viewProvider };
