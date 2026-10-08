import { runDueScheduledTasks, Schedule } from "@getstrata/core/scheduler/schedule";
import { RedisClient } from "bun";

const [namespace, date, mode] = process.argv.slice(2);
if (!namespace || !date || !mode || !process.env.REDIS_URL)
  throw new Error("Missing scheduler worker configuration.");
const client = new RedisClient(process.env.REDIS_URL);
const schedule = new Schedule().command("* * * * *", "effect", async ({ signal }) => {
  await client.incr(`${namespace}:effects`);
  if (mode === "hold")
    await new Promise<void>((resolve) =>
      signal.addEventListener("abort", () => resolve(), { once: true }),
    );
  else await Bun.sleep(900);
});
try {
  const completed = await runDueScheduledTasks(schedule, new Date(date), {
    coordination: "redis",
    namespace,
    leaseMs: 300,
    renewalMs: 70,
    commandTimeoutMs: 75,
    completedRetentionMs: 2000,
  });
  console.log(JSON.stringify({ completed }));
} finally {
  client.close();
}
