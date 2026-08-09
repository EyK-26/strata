import type { AppModule } from "@getstrata/bootstrap/contracts";
import { CACHE_TAGS } from "@getstrata/core/cache/tags";
import OrganizationController from "./controller";
import organizationProvider, {
  organizationRepositoryToken,
  organizationServiceToken,
} from "./provider";
import { createOrganizationRoutes } from "./routes";
import { organizationTable } from "./table";
import { createOrganizationWebRoutes } from "./webRoutes";

const organizationModule: AppModule = {
  name: "organization",
  order: 10,
  tableName: organizationTable.name,
  cacheTags: [CACHE_TAGS.organizations, CACHE_TAGS.reports],
  cacheDeleteExtraTags: [CACHE_TAGS.projects],
  providers: [organizationProvider],
  routes({ dependencies, cachedJson, kernel }) {
    return createOrganizationRoutes(dependencies, cachedJson, kernel);
  },
  webRoutes({ dependencies, kernel }) {
    return createOrganizationWebRoutes(dependencies, kernel);
  },
};

export default organizationModule;
export { default as OrganizationRepository } from "./repository";
export {
  parseCreateOrganizationBody,
  parseOrganizationIdParams,
  parseOrganizationListQuery,
  parseUpdateOrganizationBody,
} from "./requests";
export {
  toOrganizationResource,
  toOrganizationResourceCollection,
} from "./resources";
export { createOrganizationRoutes } from "./routes";
export { default as OrganizationService } from "./service";
export { organizationTable } from "./table";
export type { OrganizationRecord } from "./types";
export {
  OrganizationController,
  organizationProvider,
  organizationRepositoryToken,
  organizationServiceToken,
};
