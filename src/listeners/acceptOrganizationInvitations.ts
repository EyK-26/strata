import { type EventBus, eventBus, modelEventName } from "@getstrata/core/events";
import { logSecurityEvent } from "@getstrata/core/security/securityEvents";
import { resolveInvitationService } from "../modules/organization/invitationService";

const registeredBuses = new WeakSet<EventBus>();

async function acceptPendingInvitationsForUser(payload: unknown): Promise<number> {
  const user = payload as { id?: number; email?: string } | null;

  if (!user?.id || !user.email) {
    return 0;
  }

  try {
    return await resolveInvitationService().acceptPendingForUser({
      id: user.id,
      email: user.email,
    });
  } catch (error) {
    logSecurityEvent("organization_invitation_auto_accept_failed", {
      user_id: user.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return 0;
  }
}

function registerAcceptOrganizationInvitationListeners(): void {
  if (registeredBuses.has(eventBus)) {
    return;
  }

  registeredBuses.add(eventBus);
  eventBus.listen(modelEventName("users", "created"), async (payload) => {
    await acceptPendingInvitationsForUser(payload);
  });
}

export default registerAcceptOrganizationInvitationListeners;
export { acceptPendingInvitationsForUser };
