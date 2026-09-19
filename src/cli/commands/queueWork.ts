import { createAppContext } from "@getstrata/bootstrap/context";
import { registerDefaultJobs } from "@getstrata/bootstrap/queue/defaultJobs";
import { runQueueWorkerCommand } from "@getstrata/cli/queueWorker";
import { closeDatabase } from "../../db/connection";

async function queueWorkCommand(): Promise<void> {
  await runQueueWorkerCommand({
    boot() {
      createAppContext();
      registerDefaultJobs();
    },
    close: closeDatabase,
  });
}

export { queueWorkCommand };
