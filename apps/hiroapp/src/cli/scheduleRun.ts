async function scheduleRunCommand(): Promise<void> {
  const { createScheduleRunCommand } = await import("@getstrata/cli/schedule");
  await createScheduleRunCommand(async () => {
    const { bootstrapApp } = await import("../bootstrap/createApp.ts");
    await bootstrapApp({ migrate: false });
    await import("../bootstrap/schedule.ts");
  })();
}

export { scheduleRunCommand };
