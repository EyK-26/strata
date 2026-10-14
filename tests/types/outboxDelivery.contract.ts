import type { OutboxDeliverySnapshot, SqlOutbox } from "@getstrata/core/events/outbox";
export async function inspectDeliveryContract(outbox: SqlOutbox) {
  const delivery: OutboxDeliverySnapshot | null = await outbox.getDelivery("event", "listener");
  if (delivery) {
    const attempts: number = delivery.attempts;
    // @ts-expect-error Inspection does not expose private payloads.
    delivery.payload;
    // @ts-expect-error Inspection does not expose renewable lease tokens.
    delivery.leaseToken;
    // @ts-expect-error Snapshot fields are readonly.
    delivery.status = "pending";
    void attempts;
  }
}
