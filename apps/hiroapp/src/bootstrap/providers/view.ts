import { join } from "node:path";
import type { ServiceProvider } from "@getstrata/bootstrap/contracts";
import { currentAuthUser } from "@getstrata/core/auth/authContext";
import { currentRequestMeta } from "@getstrata/core/http/requestMetaContext";
import { isViewsEnabled } from "@getstrata/core/runtime/frontendMode";
import {
  configureWebErrorView,
  configureWebLayoutData,
  DEFAULT_VIEWS_DIRECTORY,
  EtaViewEngine,
  errorTemplateName,
} from "@getstrata/core/view";
import { bindViewEngine } from "../../http/view.ts";
import { loadUserGraph } from "../../lib/loaders.ts";
import { serializeNotification, serializeUser } from "../../lib/serialize.ts";
import type { Notification } from "../../models/Notification.ts";
import { User } from "../../models/User.ts";
import { users } from "../../modules/users/repository.ts";

export const CORE_VIEW_TOKEN = "core.view";

export const viewProvider: ServiceProvider = {
  name: "hiroapp.view",
  register({ container }) {
    if (!isViewsEnabled()) {
      return;
    }

    const viewsDirectory =
      process.env.VIEW_DIRECTORY?.trim() ||
      join(import.meta.dir, "../../../resources/views") ||
      DEFAULT_VIEWS_DIRECTORY;
    const engine = new EtaViewEngine(viewsDirectory, async (request) => {
      const { resolveWebLayoutData } = await import("@getstrata/core/view");
      return resolveWebLayoutData(container, request ?? currentRequestMeta().request);
    });
    container.set(CORE_VIEW_TOKEN, engine);
    bindViewEngine(engine);

    configureWebLayoutData({
      userKey: "currentUser",
      loadUser: async () => {
        const authUser = currentAuthUser();
        if (!authUser) {
          return null;
        }
        const record = await users.findById(Number(authUser.id));
        if (!record) {
          return null;
        }
        const graph = await loadUserGraph(record);
        return serializeUser(record, {
          notifications: graph.notifications.map(serializeNotification),
          position: graph.position,
        });
      },
      extra: async (user) => {
        if (!user || typeof user !== "object" || !("id" in user)) {
          return { notifications: [] };
        }
        const owner = await User.find(Number((user as { id: number }).id));
        const rows = owner ? ((await owner.notifications()) as Notification[]) : [];
        return { notifications: rows.map((row) => serializeNotification(row.toObject())) };
      },
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
