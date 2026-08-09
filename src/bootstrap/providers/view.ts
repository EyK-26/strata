import { isViewsEnabled } from "../../config/frontend";
import { currentRequestMeta } from "../../core/http/requestMetaContext";
import { DEFAULT_VIEWS_DIRECTORY, EtaViewEngine, resolveWebLayoutData } from "../../core/view";
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
    container.set(
      CORE_VIEW_TOKEN,
      new EtaViewEngine(viewsDirectory, () =>
        resolveWebLayoutData(container, currentRequestMeta().request),
      ),
    );
  },
};

export { CORE_VIEW_TOKEN, VIEW_DIRECTORY_CONFIG_KEY, viewProvider };
