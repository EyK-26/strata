async function queueWorkCommand(): Promise<void> {
  if (!process.env.REDIS_URL) {
    throw new Error("queue:work requires REDIS_URL to be set.");
  }

  const { runQueueWorkerCommand } = await import("@getstrata/cli/queueWorker");
  const { bootstrapApp } = await import("../bootstrap/createApp.ts");
  const { closeDatabase } = await import("../bootstrap/database.ts");

  await runQueueWorkerCommand({
    boot: () => bootstrapApp({ migrate: false }),
    close: closeDatabase,
  });
}

export { queueWorkCommand };
