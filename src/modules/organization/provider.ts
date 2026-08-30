import { CORE_POLICY_GATE_TOKEN } from "@getstrata/bootstrap/config";
import { configureMembershipLookup } from "@getstrata/core/auth/membershipContext";
import type { ServiceProvider } from "@getstrata/core/contracts/di";
import { currentOrganizationServiceToken } from "../user/currentOrganizationService";
import UserRepository from "../user/repository";
import OrganizationInvitationRepository from "./invitationRepository";
import {
  OrganizationInvitationService,
  organizationInvitationServiceToken,
} from "./invitationService";
import OrganizationMemberRepository from "./memberRepository";
import OrganizationPolicy from "./policy";
import OrganizationRepository from "./repository";
import OrganizationService from "./service";

const organizationRepositoryToken = "organization.repository";
const organizationServiceToken = "organization.service";
const organizationPolicyToken = "organization.policy";

const organizationProvider: ServiceProvider = {
  name: "organization.provider",
  register({ container }) {
    configureMembershipLookup(new OrganizationMemberRepository());
    container.singleton(organizationRepositoryToken, () => new OrganizationRepository());
    container.singleton(organizationPolicyToken, () => new OrganizationPolicy());
  },
  boot({ container }) {
    container.singleton(
      organizationServiceToken,
      () =>
        new OrganizationService(
          container.resolve(organizationRepositoryToken),
          container.resolve(currentOrganizationServiceToken),
        ),
    );
    container.singleton(
      organizationInvitationServiceToken,
      () =>
        new OrganizationInvitationService(
          new OrganizationInvitationRepository(),
          new UserRepository(),
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
  organizationInvitationServiceToken,
  organizationPolicyToken,
  organizationRepositoryToken,
  organizationServiceToken,
};
