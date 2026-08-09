import type { AppModule } from "@getstrata/bootstrap/contracts";
import { CACHE_TAGS } from "@getstrata/core/cache/tags";
import ProjectController from "./controller";
import projectProvider, { projectRepositoryToken, projectServiceToken } from "./provider";
import { createProjectRoutes } from "./routes";
import { projectTable } from "./table";
import { createProjectWebRoutes } from "./webRoutes";

const projectModule: AppModule = {
  name: "project",
  order: 20,
  tableName: projectTable.name,
  cacheTags: [CACHE_TAGS.projects],
  providers: [projectProvider],
  routes({ dependencies, cachedJson, kernel }) {
    return createProjectRoutes(dependencies, cachedJson, kernel);
  },
  webRoutes({ dependencies, kernel }) {
    return createProjectWebRoutes(dependencies, kernel);
  },
};

export default projectModule;
export { projectBelongsToOrganization } from "./relationships";
export { default as ProjectRepository } from "./repository";
export {
  parseCreateProjectBody,
  parseProjectIdParams,
  parseProjectListQuery,
  parseUpdateProjectBody,
} from "./requests";
export { toProjectResource, toProjectResourceCollection } from "./resources";
export { createProjectRoutes } from "./routes";
export { default as ProjectService } from "./service";
export { projectTable } from "./table";
export type { ProjectRecord, ProjectWithOrganizationRecord } from "./types";
export { ProjectController, projectProvider, projectRepositoryToken, projectServiceToken };
