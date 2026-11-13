import { createQueueFailedCommands } from "@getstrata/cli/queueFailed";
import { bootQueueApplication } from "./queueApplication";

const { queueFailedCommand, queueFlushFailedCommand, queueRetryCommand } =
  createQueueFailedCommands(bootQueueApplication);

export { queueFailedCommand, queueFlushFailedCommand, queueRetryCommand };
