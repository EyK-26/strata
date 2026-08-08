import type { ServiceProvider } from "../../bootstrap/contracts";
import { CORE_POLICY_GATE_TOKEN } from "../../bootstrap/config";
import OrganizationRepository from "../organization/repository";
import ProjectRepository from "./repository";
import ProjectService from "./service";
import ProjectPolicy from "./policy";

const projectRepositoryToken = "project.repository";
const projectServiceToken = "project.service";
const projectPolicyToken = "project.policy";

const projectProvider: ServiceProvider = {
  name: "project.provider",
  register({ container }) {
    container.singleton(projectRepositoryToken, () => {
      const organizationRepository = container.resolve<OrganizationRepository>(
        "organization.repository",
      );
      return new ProjectRepository(organizationRepository);
    });
    container.singleton(projectPolicyToken, () => new ProjectPolicy());
  },
  boot({ container }) {
    container.singleton(
      projectServiceToken,
      () =>
        new ProjectService(
          container.resolve(projectRepositoryToken),
          container.resolve("organization.repository"),
        ),
    );

    const gate = container.resolve<{ register: (resource: string, policy: unknown) => void }>(
      CORE_POLICY_GATE_TOKEN,
    );
    gate.register("project", container.resolve(projectPolicyToken));
  },
};

export default projectProvider;
export { projectRepositoryToken, projectServiceToken, projectPolicyToken };
