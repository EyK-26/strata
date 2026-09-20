async function bootApp(): Promise<void> {
  const { bootstrapApp } = await import("../bootstrap/createApp.ts");
  await bootstrapApp({ migrate: false });
}

async function queueFailedCommand(): Promise<void> {
  const { queueFailedCommand: run } = await import("@getstrata/cli/queueFailed");
  await run(bootApp);
}

async function queueRetryCommand(id?: string): Promise<void> {
  const { queueRetryCommand: run } = await import("@getstrata/cli/queueFailed");
  await run(id, bootApp);
}

async function queueFlushFailedCommand(): Promise<void> {
  const { queueFlushFailedCommand: run } = await import("@getstrata/cli/queueFailed");
  await run(bootApp);
}

export { queueFailedCommand, queueFlushFailedCommand, queueRetryCommand };
