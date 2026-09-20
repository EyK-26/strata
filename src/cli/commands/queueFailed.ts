import { createQueueFailedCommands } from "@getstrata/cli/queueFailed";

const { queueFailedCommand, queueFlushFailedCommand, queueRetryCommand } =
  createQueueFailedCommands();

export { queueFailedCommand, queueFlushFailedCommand, queueRetryCommand };
