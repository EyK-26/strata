import { appSchedule } from "@getstrata/core/scheduler/schedule";
import { Position } from "./models/Position.ts";

async function closeExpiredPositions(now = new Date()): Promise<number> {
  const open = await Position.where({ hiring: true }).get();
  let closed = 0;
  for (const position of open) {
    const end = position.get("end_date") as Date | string | null;
    if (!end) {
      continue;
    }
    const endDate = end instanceof Date ? end : new Date(end);
    if (Number.isNaN(endDate.getTime()) || endDate >= now) {
      continue;
    }
    await position.update({ hiring: false });
    closed += 1;
  }
  return closed;
}

appSchedule.command("0 * * * *", "close-expired-positions", async () => {
  await closeExpiredPositions();
});

export { closeExpiredPositions };
