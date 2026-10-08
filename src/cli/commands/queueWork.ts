import { createAppContext, type InitializedAppContext } from "@getstrata/bootstrap/context";
import { discoverJobs } from "@getstrata/bootstrap/discoverJobs";
import { registerDefaultJobs } from "@getstrata/bootstrap/queue/defaultJobs";
import { assertProductionSecrets } from "@getstrata/bootstrap/secretsGuard";
import { runQueueWorkerCommand } from "@getstrata/cli/queueWorker";
import { closeDatabase } from "../../db/connection";

async function queueWorkCommand(): Promise<void> {
  let context: InitializedAppContext | undefined;
  await runQueueWorkerCommand({
    boot: async () => {
      assertProductionSecrets();
      context = await createAppContext();
      registerDefaultJobs();
      await discoverJobs();
    },
    drain: () => context?.drain(),
    flush: () => context?.flush(),
    close: async () => {
      try {
        await context?.dispose();
      } finally {
        await closeDatabase();
      }
    },
  });
}

export { queueWorkCommand };
