import { appSchedule } from "@getstrata/core/scheduler/schedule";
import { careerService } from "./modules/careers/service.ts";
import { holdService } from "./modules/holds/service.ts";
import { offerService } from "./modules/offers/service.ts";
import { positionService } from "./modules/positions/service.ts";

async function closeExpiredPositions(now = new Date()): Promise<number> {
  return positionService.closeExpired(now);
}

async function refreshHiringDeadlines(now = new Date()) {
  const [holds, careers, offers] = await Promise.all([
    holdService.releaseDue(now),
    careerService.refreshDue(now),
    offerService.expireDue(now),
  ]);
  return { holds, careers, offers };
}

appSchedule.command("0 * * * *", "close-expired-positions", async () => {
  await closeExpiredPositions();
});

appSchedule.command("* * * * *", "refresh-hiring-deadlines", async () => {
  await refreshHiringDeadlines();
});

export { closeExpiredPositions, refreshHiringDeadlines };
