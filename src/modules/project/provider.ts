import { CORE_POLICY_GATE_TOKEN } from "@getstrata/bootstrap/config";
import type { ServiceProvider } from "@getstrata/bootstrap/contracts";
import type OrganizationRepository from "../organization/repository";
import ProjectPolicy from "./policy";
import ProjectRepository from "./repository";
import ProjectService from "./service";

const projectRepositoryToken = "project.repository";
const projectServiceToken = "project.service";
const projectPolicyToken = "project.policy";

const projectProvider: ServiceProvider = {
  name: "project.provider",
  register({ container }) {
    container.singleton(projectRepositoryToken, () => {
      const organizationRepository =
        container.resolve<OrganizationRepository>("organization.repository");
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
export { projectPolicyToken, projectRepositoryToken, projectServiceToken };
