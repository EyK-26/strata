import { runQueueWorkerCommand } from "@getstrata/cli/queueWorker";
import { bootQueueApplication } from "./queueApplication";

async function queueWorkCommand(): Promise<void> {
  await runQueueWorkerCommand({ boot: () => bootQueueApplication(true) });
}

export { queueWorkCommand };
