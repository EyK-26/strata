import type { ServiceProvider } from "@getstrata/core/contracts/di";
import type CommentRepository from "../comment/repository";
import type OrganizationRepository from "../organization/repository";
import type ProjectRepository from "../project/repository";
import type TaskRepository from "../task/repository";
import SearchService from "./service";

const searchServiceToken = "search.service";

const searchProvider: ServiceProvider = {
  name: "search.provider",
  register({ container }) {
    container.singleton(searchServiceToken, () => {
      return new SearchService(
        container.resolve<TaskRepository>("task.repository"),
        container.resolve<CommentRepository>("comment.repository"),
        container.resolve<OrganizationRepository>("organization.repository"),
        container.resolve<ProjectRepository>("project.repository"),
      );
    });
  },
};

export default searchProvider;
export { searchServiceToken };
