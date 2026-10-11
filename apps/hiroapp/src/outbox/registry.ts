import type { DurableListener } from "@getstrata/core/events/outbox";

/** Add listeners before publishing. An empty registry can run, and publish rejects unknown events. */
const listeners: readonly DurableListener[] = [];

export { listeners };
