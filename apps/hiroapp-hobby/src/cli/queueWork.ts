async function queueWorkCommand(): Promise<void> {
  if (!process.env.REDIS_URL) {
    throw new Error("queue:work requires REDIS_URL to be set.");
  }

  const { runQueueWorkerCommand } = await import("@getstrata/cli/queueWorker");
  const { bootstrapApp } = await import("../bootstrap/createApp.ts");
  const { closeDatabase } = await import("../bootstrap/database.ts");

  let app: Awaited<ReturnType<typeof bootstrapApp>> | undefined;
  await runQueueWorkerCommand({
    boot: async () => {
      app = await bootstrapApp({ migrate: false });
    },
    drain: () => app?.context.drain(),
    flush: () => app?.context.flush(),
    close: async () => {
      try {
        await app?.context.dispose();
      } finally {
        await closeDatabase();
      }
    },
  });
}

export { queueWorkCommand };
