import { createAppContext, type InitializedAppContext } from "@getstrata/bootstrap/context";
import { createScheduleRunCommand } from "@getstrata/cli/schedule";
import { closeDatabase } from "../../db/connection";

async function scheduleRunCommand(): Promise<void> {
  let context: InitializedAppContext | undefined;
  await createScheduleRunCommand(
    async () => {
      context = await createAppContext();
      await import("../../bootstrap/schedule");
    },
    async () => {
      try {
        await context?.dispose();
      } finally {
        await closeDatabase();
      }
    },
  )();
}

export { scheduleRunCommand };
