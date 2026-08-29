import { describe, expect, mock, test } from "bun:test";
import { ConfigStore, ServiceContainer } from "@getstrata/bootstrap/contracts";
import { setActiveApplicationContext } from "@getstrata/core/runtime/applicationRegistry";
import { organizationInvitationServiceToken } from "../../src/modules/organization/invitationService";
import { createMockDependencies } from "./testHelpers";

describe("acceptOrganizationInvitations listener", () => {
  test("acceptPendingInvitationsForUser ignores incomplete payloads and records failures", async () => {
    const { acceptPendingInvitationsForUser } = await import(
      "../../src/listeners/acceptOrganizationInvitations"
    );

    expect(await acceptPendingInvitationsForUser(null)).toBe(0);
    expect(await acceptPendingInvitationsForUser({ id: 1 })).toBe(0);

    const acceptPendingForUser = mock(async () => 2);
    const container = new ServiceContainer();
    container.set(organizationInvitationServiceToken, { acceptPendingForUser });
    setActiveApplicationContext({
      container,
      config: new ConfigStore(),
      dependencies: createMockDependencies(container),
    });

    expect(await acceptPendingInvitationsForUser({ id: 4, email: "join@workhub.test" })).toBe(2);
    expect(acceptPendingForUser).toHaveBeenCalledWith({ id: 4, email: "join@workhub.test" });

    container.set(organizationInvitationServiceToken, {
      acceptPendingForUser: mock(async () => {
        throw new Error("join failed");
      }),
    });
    expect(await acceptPendingInvitationsForUser({ id: 4, email: "join@workhub.test" })).toBe(0);
  });
});
