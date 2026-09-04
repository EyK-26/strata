import { appSchedule } from "@getstrata/core/scheduler/schedule";
import { positionService } from "./modules/positions/service.ts";

async function closeExpiredPositions(now = new Date()): Promise<number> {
  return positionService.closeExpired(now);
}

appSchedule.command("0 * * * *", "close-expired-positions", async () => {
  await closeExpiredPositions();
});

export { closeExpiredPositions };
