import { appSchedule } from "../core/scheduler/schedule";
import { appLogger } from "../core/logging/logger";

appSchedule.command("* * * * *", "heartbeat", () => {
  appLogger.debug("Scheduler heartbeat");
});

export {};
