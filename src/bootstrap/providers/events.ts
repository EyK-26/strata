import { eventBus } from "@getstrata/core/events";
import { CORE_EVENT_BUS_TOKEN } from "../config";
import type { ServiceProvider } from "../contracts";

const eventsProvider: ServiceProvider = {
  name: "core.events",
  register({ container }) {
    container.set(CORE_EVENT_BUS_TOKEN, eventBus);
  },
};

export default eventsProvider;
export { CORE_EVENT_BUS_TOKEN };
