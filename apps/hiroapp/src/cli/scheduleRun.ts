async function scheduleRunCommand(): Promise<void> {
  const { createScheduleRunCommand } = await import("@getstrata/cli/schedule");
  const { bootstrapApp } = await import("../bootstrap/createApp.ts");
  const { closeDatabase } = await import("../bootstrap/database.ts");
  let app: Awaited<ReturnType<typeof bootstrapApp>> | undefined;
  await createScheduleRunCommand(
    async () => {
      app = await bootstrapApp({ migrate: false });
      await import("../bootstrap/schedule.ts");
    },
    async () => {
      try {
        await app?.context.dispose();
      } finally {
        await closeDatabase();
      }
    },
  )();
}

export { scheduleRunCommand };
