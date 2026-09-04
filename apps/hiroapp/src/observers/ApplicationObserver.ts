import { eventBus } from "@getstrata/core/events";
import { APPLICATION_SUBMITTED } from "../events/ApplicationSubmitted.ts";
import type { Application } from "../models/Application.ts";

export const applicationObserver = {
  async created(application: Application) {
    await eventBus.emit(APPLICATION_SUBMITTED, { application });
  },
};
