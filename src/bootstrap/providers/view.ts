import { currentRequestMeta } from "@getstrata/core/http/requestMetaContext";
import {
  configureWebErrorView,
  DEFAULT_VIEWS_DIRECTORY,
  EtaViewEngine,
  errorTemplateName,
  resolveWebLayoutData,
} from "@getstrata/core/view";
import { isViewsEnabled } from "../../config/frontend";
import type { ServiceProvider } from "../contracts";

const CORE_VIEW_TOKEN = "core.view";
const VIEW_DIRECTORY_CONFIG_KEY = "view.directory";

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

export { CORE_VIEW_TOKEN, VIEW_DIRECTORY_CONFIG_KEY, viewProvider };
