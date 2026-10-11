async function outboxWorkCommand(): Promise<void> {
  const { runOutboxWorkerCommand } = await import("@getstrata/cli/outboxWorker");
  const { listeners } = await import("../outbox/registry.ts");
  const { bootstrapApp } = await import("../bootstrap/createApp.ts");
  const { closeDatabase } = await import("../bootstrap/database.ts");

  let app: Awaited<ReturnType<typeof bootstrapApp>> | undefined;
  await runOutboxWorkerCommand({
    listeners,
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

export { outboxWorkCommand };
