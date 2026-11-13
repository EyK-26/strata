import { valueService } from "@getstrata/core/contracts/services";
import { createServiceToken } from "@getstrata/core/contracts/token";
import { EventBus } from "@getstrata/core/events";
import { CORE_EVENT_BUS_TOKEN } from "../config";
import type { ServiceProvider } from "../contracts";
export const APPLICATION_EVENT_BUS_TOKEN = createServiceToken<EventBus>("bootstrap.events");
/** Non-ORM custom events keep one explicit app-owned dispatcher. */
export function createEventBindings() {
  return Object.freeze([valueService(APPLICATION_EVENT_BUS_TOKEN, new EventBus())]);
}
export function createEventsProvider(bus: EventBus): ServiceProvider {
  return {
    name: "core.events",
    register({ container }) {
      container.set(CORE_EVENT_BUS_TOKEN, bus);
    },
  };
}
export { CORE_EVENT_BUS_TOKEN };
