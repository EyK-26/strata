import { auditService } from "../modules/audit/service.ts";
import { webhookService } from "../modules/webhooks/service.ts";

export async function recordHiringEvent(
  event: string,
  payload: Record<string, unknown>,
  subject: { type: string; id?: number | null } = { type: "hiring" },
): Promise<void> {
  await auditService.record({
    action: event,
    subjectType: subject.type,
    subjectId: subject.id ?? null,
    payload,
  });
  try {
    await webhookService.dispatch(event, payload);
  } catch {
    // Hiring writes should not fail because a subscriber is down.
  }
}
