import { CORE_POLICY_GATE_TOKEN } from "../../bootstrap/config";
import type { ServiceProvider } from "../../bootstrap/contracts";
import type ProjectRepository from "../project/repository";
import TaskPolicy from "./policy";
import TaskRepository from "./repository";
import TaskService from "./service";

const taskRepositoryToken = "task.repository";
const taskServiceToken = "task.service";
const taskPolicyToken = "task.policy";

const taskProvider: ServiceProvider = {
  name: "task.provider",
  register({ container }) {
    container.singleton(taskRepositoryToken, () => {
      const projectRepository = container.resolve<ProjectRepository>("project.repository");
      return new TaskRepository(projectRepository);
    });
    container.singleton(taskPolicyToken, () => new TaskPolicy());
  },
  boot({ container }) {
    container.singleton(
      taskServiceToken,
      () =>
        new TaskService(
          container.resolve(taskRepositoryToken),
          container.resolve("project.repository"),
          container.resolve("organization.repository"),
        ),
    );

    const gate = container.resolve<{ register: (resource: string, policy: unknown) => void }>(
      CORE_POLICY_GATE_TOKEN,
    );
    gate.register("task", container.resolve(taskPolicyToken));
  },
};

export default taskProvider;
export { taskPolicyToken, taskRepositoryToken, taskServiceToken };
