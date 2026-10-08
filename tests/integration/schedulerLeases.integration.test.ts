import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  RedisSchedulerLeaseStore,
  runDueScheduledTasks,
  Schedule,
} from "@getstrata/core/scheduler/schedule";
import { RedisClient } from "bun";

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
function scope() {
  return `test:scheduler:${crypto.randomUUID()}`;
}
const timing = {
  coordination: "redis" as const,
  redisUrl,
  leaseMs: 300,
  renewalMs: 70,
  commandTimeoutMs: 75,
  completedRetentionMs: 2000,
};
function worker(namespace: string, now: Date, mode = "once") {
  return Bun.spawn(
    [process.execPath, "tests/fixtures/schedulerWorker.ts", namespace, now.toISOString(), mode],
    { env: { ...process.env, REDIS_URL: redisUrl }, stdout: "pipe", stderr: "pipe" },
  );
}
async function result(child: ReturnType<typeof worker>) {
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (code !== 0) throw new Error(`Scheduler child failed (${code}): ${stderr}`);
  return JSON.parse(stdout) as { completed: number };
}

test("three real scheduler processes renew a slow occurrence and only one applies its effect", async () => {
  const namespace = scope();
  const now = new Date();
  const client = new RedisClient(redisUrl);
  const children = Array.from({ length: 3 }, () => worker(namespace, now));
  try {
    const results = await Promise.all(children.map(result));
    expect(results.reduce((total, item) => total + item.completed, 0)).toBe(1);
    expect(Number(await client.get(`${namespace}:effects`))).toBe(1);
    expect((await result(worker(namespace, now))).completed).toBe(0);
  } finally {
    for (const child of children) child.kill();
    await client.del(`${namespace}:effects`);
    client.close();
  }
}, 10_000);

test("killed owner expires and another process replays the same occurrence", async () => {
  const namespace = scope();
  const now = new Date();
  const client = new RedisClient(redisUrl);
  const child = worker(namespace, now, "hold");
  try {
    const deadline = Date.now() + 4000;
    while (!(await client.get(`${namespace}:effects`))) {
      if (Date.now() > deadline) throw new Error("Scheduler owner did not start.");
      await Bun.sleep(10);
    }
    child.kill("SIGKILL");
    await child.exited;
    await Bun.sleep(350);
    expect((await result(worker(namespace, now))).completed).toBe(1);
    // A side effect performed before death can repeat: this is deliberately not exactly once.
    expect(Number(await client.get(`${namespace}:effects`))).toBe(2);
  } finally {
    child.kill();
    await client.del(`${namespace}:effects`);
    client.close();
  }
}, 10_000);

test("stale ownership cannot renew, complete or release another runner's occurrence", async () => {
  const store = new RedisSchedulerLeaseStore({
    redisUrl,
    namespace: scope(),
    commandTimeoutMs: 75,
  });
  const old = { taskId: "task", occurrenceId: "one", token: crypto.randomUUID() };
  const next = { ...old, token: crypto.randomUUID() };
  try {
    expect(await store.acquire(old, 100)).toBe(true);
    await Bun.sleep(120);
    expect(await store.acquire(next, 1000)).toBe(true);
    expect(await store.renew(old, 1000)).toBe(false);
    expect(await store.complete(old, 1000)).toBe(false);
    await store.release(old);
    expect(await store.renew(next, 1000)).toBe(true);
    expect(await store.complete(next, 1000)).toBe(true);
    expect(await store.acquire(old, 100)).toBe(false);
  } finally {
    store.close();
  }
});

test("different minute occurrences cannot overlap while a task's lease is renewed", async () => {
  const namespace = scope();
  let entered: () => void = () => {};
  let release: () => void = () => {};
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const now = new Date();
  const first = new Schedule().command("* * * * *", "task", async ({ assertOwnership }) => {
    entered();
    await gate;
    await assertOwnership();
  });
  let overlap = false;
  const second = new Schedule().command("* * * * *", "task", () => {
    overlap = true;
  });
  const running = runDueScheduledTasks(first, now, { ...timing, namespace });
  try {
    await started;
    await Bun.sleep(650);
    expect(
      await runDueScheduledTasks(second, new Date(now.getTime() + 60_000), {
        ...timing,
        namespace,
      }),
    ).toBe(0);
    expect(overlap).toBe(false);
    release();
    expect(await running).toBe(1);
    expect(
      await runDueScheduledTasks(second, new Date(now.getTime() + 60_000), {
        ...timing,
        namespace,
      }),
    ).toBe(1);
  } finally {
    release();
    await running.catch(() => {});
  }
});

test("namespace isolation and task failure allow deliberate retry without premature completion", async () => {
  const namespace = scope();
  const now = new Date();
  let attempts = 0;
  const ids: string[] = [];
  const task = new Schedule().command("* * * * *", "task", ({ occurrenceId }) => {
    ids.push(occurrenceId);
    if (++attempts === 1) throw new Error("business failed");
  });
  await expect(runDueScheduledTasks(task, now, { ...timing, namespace })).rejects.toThrow(
    "business failed",
  );
  expect(await runDueScheduledTasks(task, now, { ...timing, namespace })).toBe(1);
  expect(await runDueScheduledTasks(task, now, { ...timing, namespace })).toBe(0);
  expect(
    await runDueScheduledTasks(task, now, { ...timing, namespace: `${namespace}:other` }),
  ).toBe(1);
  expect(ids[0]).toBe(ids[1]);
  expect(ids[2]).not.toBe(ids[0]);
});

test("completion metadata expires and closing a borrowed store leaves its Redis client usable", async () => {
  const client = new RedisClient(redisUrl);
  const store = new RedisSchedulerLeaseStore({ redisUrl, namespace: scope(), client });
  const lease = { taskId: "task", occurrenceId: "one", token: crypto.randomUUID() };
  try {
    expect(await store.acquire(lease, 1000)).toBe(true);
    expect(await store.complete(lease, 100)).toBe(true);
    expect(await store.acquire(lease, 1000)).toBe(false);
    await Bun.sleep(120);
    expect(await store.acquire(lease, 1000)).toBe(true);
    await store.release(lease);
    store.close();
    expect(await client.send("PING", [])).toBe("PONG");
  } finally {
    client.close();
  }
});

test("rolling definitions retain the same occurrence identity", async () => {
  const namespace = scope();
  const now = new Date();
  let effects = 0;
  const previous = new Schedule().command("* * * * *", "stable-task", () => {
    effects++;
  });
  const next = new Schedule().command("*/1 * * * *", "stable-task", () => {
    effects++;
  });
  expect(await runDueScheduledTasks(previous, now, { ...timing, namespace })).toBe(1);
  expect(await runDueScheduledTasks(next, now, { ...timing, namespace })).toBe(0);
  expect(effects).toBe(1);
});

test("wrong Redis key types fail before any lease mutation", async () => {
  const namespace = scope();
  const lease = { taskId: "task", occurrenceId: "one", token: crypto.randomUUID() };
  const digest = createHash("sha256")
    .update(JSON.stringify([namespace, lease.taskId]))
    .digest("hex");
  const occurrence = createHash("sha256").update(lease.occurrenceId).digest("hex");
  const active = `scheduler:{${digest}}:active`;
  const malformed = `scheduler:{${digest}}:completed:${occurrence}`;
  const client = new RedisClient(redisUrl);
  const store = new RedisSchedulerLeaseStore({ redisUrl, namespace });
  try {
    await client.send("LPUSH", [malformed, "bad-type"]);
    await expect(store.acquire(lease, 1000)).rejects.toThrow("Unexpected scheduler key type");
    expect(await client.get(active)).toBeNull();
  } finally {
    await client.del(malformed);
    store.close();
    client.close();
  }
});
