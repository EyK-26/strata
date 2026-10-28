import { expect, test } from "bun:test";
import { collectProviders } from "@getstrata/bootstrap/context";
import * as m1 from "@getstrata/bootstrap/m1";

const providers = () =>
  collectProviders([]).filter((provider) =>
    ["core.config", "core.cache", "core.storage", "core.auth", "core.policy"].includes(
      provider.name,
    ),
  );

test("invalid cleanup budgets fail before provider acquisition and leave retry available", async () => {
  let acquired = 0;
  for (const budget of [0, -1, 0.5, NaN, Infinity, 2147483648, null, false, "20"]) {
    let app: Awaited<ReturnType<typeof m1.startGuardedApplication>> | undefined;
    try {
      const options: m1.M1ApplicationOptions = {
        startupCleanupTimeoutMs: budget as number,
        providers: [
          ...providers(),
          {
            name: "untouched",
            register() {
              acquired++;
            },
          },
        ],
        modules: [],
      };
      await expect(
        m1.startGuardedApplication(options).then((value) => {
          app = value;
          return value;
        }),
      ).rejects.toThrow("invalid-cleanup-timeout");
      expect(acquired).toBe(0);
    } finally {
      await app?.shutdown();
    }
  }
  const retry = await m1.startGuardedApplication({ providers: providers(), modules: [] });
  expect((await retry.shutdown()).successful).toBe(true);
});

test("completion lookup reads only framework records, never unknown error getters", () => {
  let reads = 0;
  const error = Object.defineProperty({}, "message", {
    get() {
      reads++;
      throw new Error("private");
    },
  });
  expect(typeof m1.getM1StartupCleanupCompletion).toBe("function");
  for (const value of [null, undefined, false, "private", 1, error, () => {}])
    expect(m1.getM1StartupCleanupCompletion(value)).toBeUndefined();
  expect(reads).toBe(0);
});

test("actual cleanup expiry retains the owner until late completion and exposes a stable handle", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let closes = 0;
  const primary = new Error("owned-local-startup-primary");
  const options: m1.M1ApplicationOptions = {
    startupCleanupTimeoutMs: 20,
    providers: [
      ...providers(),
      {
        name: "owned",
        register({ onCleanup }) {
          onCleanup(() => gate, "drain");
          onCleanup(() => {
            closes++;
          });
        },
      },
    ],
    modules: [
      {
        name: "reject",
        routes() {
          throw primary;
        },
      },
    ],
  };
  const starting = m1.startGuardedApplication(options);
  const observed = starting.then(
    () => ({ kind: "resolved" as const }),
    (failure) => ({ kind: "rejected" as const, failure }),
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      observed,
      new Promise<"pending">((resolve) => {
        timer = setTimeout(() => resolve("pending"), 200);
      }),
    ]);
    expect(result).not.toBe("pending");
    if (result === "pending" || result.kind !== "rejected")
      throw new Error("Expected bounded startup failure.");
    const failure = result.failure;
    expect(failure).toBeInstanceOf(AggregateError);
    expect(failure.cause).toBe(primary);
    const diagnostic = m1.describeM1Failure(failure);
    expect(diagnostic.code).toBe("startup-cleanup-timed-out");
    const completion = m1.getM1StartupCleanupCompletion(failure);
    expect(completion).toBeDefined();
    if (!completion) throw new Error("Expected a framework completion handle.");
    expect(m1.getM1StartupCleanupCompletion(failure)).toBe(completion);
    expect(closes).toBe(0);
    await expect(
      m1.startGuardedApplication({ providers: providers(), modules: [] }),
    ).rejects.toThrow("already active");
    release();
    const outcome = await completion;
    expect(outcome).toEqual({ state: "cleaned", startupReservationReleased: true, errors: [] });
    expect(await m1.getM1StartupCleanupCompletion(failure)).toBe(outcome);
    expect(Object.isFrozen(outcome)).toBe(true);
    expect(Object.isFrozen(outcome.errors)).toBe(true);
    expect(m1.describeM1Failure(failure)).toBe(diagnostic);
    expect(failure.cause).toBe(primary);
    expect(closes).toBe(1);
    const retry = await m1.startGuardedApplication({ providers: providers(), modules: [] });
    expect((await retry.shutdown()).successful).toBe(true);
  } finally {
    clearTimeout(timer);
    release();
    await starting.catch(() => {});
  }
});
