import { type AppModule } from "../../bootstrap/contracts";
import { CACHE_TAGS } from "../../core/cache/tags";
import ProjectController from "./controller";
import projectProvider, {
  projectRepositoryToken,
  projectServiceToken,
} from "./provider";
import { createProjectRoutes } from "./routes";
import { projectTable } from "./table";

const projectModule: AppModule = {
  name: "project",
  order: 20,
  tableName: projectTable.name,
  cacheTags: [CACHE_TAGS.projects],
  providers: [projectProvider],
  routes({ dependencies, cachedJson, kernel }) {
    return createProjectRoutes(dependencies, cachedJson, kernel);
  },
};

export default projectModule;
export { projectBelongsToOrganization } from "./relationships";
export { projectProvider, projectRepositoryToken, projectServiceToken };
export { ProjectController };
export {
  parseCreateProjectBody,
  parseProjectIdParams,
  parseProjectListQuery,
  parseUpdateProjectBody,
} from "./requests";
export { toProjectResource, toProjectResourceCollection } from "./resources";
export { createProjectRoutes } from "./routes";
export { default as ProjectRepository } from "./repository";
export { default as ProjectService } from "./service";
export { projectTable } from "./table";
export type { ProjectRecord, ProjectWithOrganizationRecord } from "./types";
