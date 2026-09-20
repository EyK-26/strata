import { createAppContext } from "@getstrata/bootstrap/context";
import { discoverJobs } from "@getstrata/bootstrap/discoverJobs";
import { registerDefaultJobs } from "@getstrata/bootstrap/queue/defaultJobs";
import { assertProductionSecrets } from "@getstrata/bootstrap/secretsGuard";
import { runQueueWorkerCommand } from "@getstrata/cli/queueWorker";
import { closeDatabase } from "../../db/connection";

async function queueWorkCommand(): Promise<void> {
  await runQueueWorkerCommand({
    boot: () => {
      assertProductionSecrets();
      createAppContext();
      registerDefaultJobs();
      discoverJobs();
    },
    close: closeDatabase,
  });
}

export { queueWorkCommand };
