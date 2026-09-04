import { eventBus } from "@getstrata/core/events";
import { APPLICATION_SUBMITTED } from "../events/ApplicationSubmitted.ts";
import { recordHiringEvent } from "../lib/hiringEvents.ts";
import type { Application } from "../models/Application.ts";

export const applicationObserver = {
  async created(application: Application) {
    await eventBus.emit(APPLICATION_SUBMITTED, { application });
    const position = await application.position().first();
    await recordHiringEvent(
      "application.submitted",
      {
        application_id: Number(application.id),
        user_id: Number(application.get("user_id")),
        position_id: Number(application.get("position_id")),
        department_id: position ? Number(position.get("department_id")) : null,
      },
      { type: "application", id: Number(application.id) },
    );
  },
};
