import { resolveMembershipLookup } from "@getstrata/core/auth/membershipContext";
import { currentRequestMeta } from "@getstrata/core/http/requestMetaContext";
import { appDisplayName } from "@getstrata/core/runtime/appKeyPrefix";
import { isViewsEnabled } from "@getstrata/core/runtime/frontendMode";
import {
  configureWebErrorView,
  configureWebLayoutData,
  DEFAULT_VIEWS_DIRECTORY,
  EtaViewEngine,
  errorTemplateName,
  resolveWebLayoutData,
} from "@getstrata/core/view";
import OrganizationRepository from "../../modules/organization/repository";
import UserRepository from "../../modules/user/repository";
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
    configureWebLayoutData({
      extra: async (user) => {
        const appName = appDisplayName();

        if (!user || typeof user.id !== "number") {
          return { appName, currentOrganization: null, organizations: [] };
        }

        try {
          const record = await new UserRepository().findByIdOrThrow(user.id);
          const memberships = await resolveMembershipLookup().listForUser(record.id);
          const organizationsRepo = new OrganizationRepository();
          const organizations = (
            await Promise.all(
              memberships.map((membership) =>
                organizationsRepo.findById(membership.organization_id),
              ),
            )
          ).filter((organization): organization is NonNullable<typeof organization> =>
            Boolean(organization && !organization.deleted_at),
          );
          const currentId = record.current_organization_id ?? null;
          const currentOrganization =
            organizations.find((organization) => organization.id === currentId) ??
            organizations[0] ??
            null;

          return { appName, currentOrganization, organizations };
        } catch {
          return { appName, currentOrganization: null, organizations: [] };
        }
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

export { CORE_VIEW_TOKEN, VIEW_DIRECTORY_CONFIG_KEY, viewProvider };
