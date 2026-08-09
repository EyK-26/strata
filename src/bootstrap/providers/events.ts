import { eventBus } from "../../core/events";
import type { ServiceProvider } from "../contracts";

const CORE_EVENT_BUS_TOKEN = "core.eventBus";

const eventsProvider: ServiceProvider = {
  name: "core.events",
  register({ container }) {
    container.set(CORE_EVENT_BUS_TOKEN, eventBus);
  },
};

export default eventsProvider;
export { CORE_EVENT_BUS_TOKEN };
