import type { ServiceProvider } from "@getstrata/bootstrap/contracts";
import type CommentRepository from "../comment/repository";
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
      );
    });
  },
};

export default searchProvider;
export { searchServiceToken };
