import { CORE_POLICY_GATE_TOKEN } from "@getstrata/bootstrap/config";
import { getRequiredDependency, type ServiceProvider } from "@getstrata/core/contracts/di";
import type OrganizationRepository from "../organization/repository";
import type ProjectRepository from "../project/repository";
import type TaskRepository from "../task/repository";
import AttachmentPolicy from "./policy";
import AttachmentRepository from "./repository";
import AttachmentService from "./service";

const attachmentRepositoryToken = "attachment.repository";
const attachmentServiceToken = "attachment.service";
const attachmentPolicyToken = "attachment.policy";

const attachmentProvider: ServiceProvider = {
  name: "attachment.provider",
  register({ container }) {
    container.singleton(attachmentRepositoryToken, () => new AttachmentRepository());
    container.singleton(attachmentPolicyToken, () => new AttachmentPolicy());
  },
  boot({ container, dependencies }) {
    container.singleton(
      attachmentServiceToken,
      () =>
        new AttachmentService(
          container.resolve(attachmentRepositoryToken),
          container.resolve<TaskRepository>("task.repository"),
          container.resolve<ProjectRepository>("project.repository"),
          container.resolve<OrganizationRepository>("organization.repository"),
          getRequiredDependency(dependencies, "storage"),
        ),
    );

    const gate = container.resolve<{ register: (resource: string, policy: unknown) => void }>(
      CORE_POLICY_GATE_TOKEN,
    );
    gate.register("attachment", container.resolve(attachmentPolicyToken));
  },
};

export default attachmentProvider;
export { attachmentPolicyToken, attachmentRepositoryToken, attachmentServiceToken };
