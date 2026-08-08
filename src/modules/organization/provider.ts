import type { ServiceProvider } from "../../bootstrap/contracts";
import { CORE_POLICY_GATE_TOKEN } from "../../bootstrap/config";
import OrganizationRepository from "./repository";
import OrganizationService from "./service";
import OrganizationPolicy from "./policy";

const organizationRepositoryToken = "organization.repository";
const organizationServiceToken = "organization.service";
const organizationPolicyToken = "organization.policy";

const organizationProvider: ServiceProvider = {
  name: "organization.provider",
  register({ container }) {
    container.singleton(
      organizationRepositoryToken,
      () => new OrganizationRepository(),
    );
    container.singleton(organizationPolicyToken, () => new OrganizationPolicy());
  },
  boot({ container }) {
    container.singleton(
      organizationServiceToken,
      () =>
        new OrganizationService(
          container.resolve(organizationRepositoryToken),
        ),
    );

    const gate = container.resolve<{ register: (resource: string, policy: unknown) => void }>(
      CORE_POLICY_GATE_TOKEN,
    );
    gate.register("organization", container.resolve(organizationPolicyToken));
  },
};

export default organizationProvider;
export {
  organizationPolicyToken,
  organizationRepositoryToken,
  organizationServiceToken,
};
