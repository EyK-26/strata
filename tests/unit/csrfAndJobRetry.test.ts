import { describe, expect, mock, test } from "bun:test";
import { createCsrfProtection, DEFAULT_CSRF_TTL_MS } from "@getstrata/core/http/csrfProtection";
import { jobRegistry } from "@getstrata/core/queue/jobRegistry";
import { runQueueJob } from "@getstrata/core/queue/jobRunner";
import { overrideQueueRecorder, withQueuePersistence } from "../helpers/queuePersistence";

describe("CSRF protection", () => {
  const secret = "csrf-test-secret-value-at-least-32-chars";

  test("a freshly generated token verifies", () => {
    const csrf = createCsrfProtection(secret);
    expect(csrf.verify(csrf.generate())).toBe(true);
  });

  test("a missing token does not verify", () => {
    const csrf = createCsrfProtection(secret);
    expect(csrf.verify(undefined)).toBe(false);
    expect(csrf.verify("")).toBe(false);
  });

  test("a tampered token does not verify", () => {
    const csrf = createCsrfProtection(secret);
    const token = csrf.generate();
    expect(csrf.verify(`${token}x`)).toBe(false);
    expect(csrf.verify(token.slice(0, -1))).toBe(false);
  });

  test("a token from another secret does not verify", () => {
    const mine = createCsrfProtection(secret);
    const theirs = createCsrfProtection("a-different-csrf-secret-value-32-chars");
    expect(mine.verify(theirs.generate())).toBe(false);
  });

  test("a token older than maxAge does not verify", async () => {
    const csrf = createCsrfProtection(secret, { expiresIn: 1, maxAge: 1 });
    const token = csrf.generate();
    await Bun.sleep(20);
    expect(csrf.verify(token)).toBe(false);
  });

  test("garbage input does not verify and does not throw", () => {
    const csrf = createCsrfProtection(secret);
    for (const value of ["not-a-token", "...", "a.b.c"]) {
      expect(csrf.verify(value)).toBe(false);
    }
  });

  test("the default lifetime is one hour", () => {
    expect(DEFAULT_CSRF_TTL_MS).toBe(60 * 60 * 1000);
  });
});

function recordingFailedJobs() {
  const failures: Array<{ jobName: string }> = [];
  return {
    failures,
    service: {
      recordFailure: async (input: { jobName: string }) => {
        failures.push(input);
      },
    },
  };
}

function queueTest(name: string, work: Parameters<typeof withQueuePersistence>[0]) {
  test(name, () => withQueuePersistence(work));
}
describe("queue job retries", () => {
  queueTest("a job that succeeds runs once and records no failure", async (persistence) => {
    const handle = mock(async () => {});
    jobRegistry.register("test.ok", () => ({ handle }));
    const { service, failures } = recordingFailedJobs();

    await runQueueJob(
      { name: "test.ok", payload: {} },
      overrideQueueRecorder(persistence, service),
    );

    expect(handle).toHaveBeenCalledTimes(1);
    expect(failures).toEqual([]);
  });

  queueTest("a failing job retries up to maxAttempts before giving up", async (persistence) => {
    let calls = 0;
    jobRegistry.register("test.always-fails", () => ({
      maxAttempts: 3,
      backoffMs: 0,
      handle: async () => {
        calls += 1;
        throw new Error("boom");
      },
    }));
    const { service, failures } = recordingFailedJobs();

    await expect(
      runQueueJob(
        { name: "test.always-fails", payload: {} },
        overrideQueueRecorder(persistence, service),
      ),
    ).rejects.toThrow("boom");

    expect(calls).toBe(3);
    expect(failures).toHaveLength(1);
    expect(failures[0]?.jobName).toBe("test.always-fails");
  });

  queueTest("a job that recovers on a retry does not record a failure", async (persistence) => {
    let calls = 0;
    jobRegistry.register("test.recovers", () => ({
      maxAttempts: 3,
      backoffMs: 0,
      handle: async () => {
        calls += 1;
        if (calls < 2) {
          throw new Error("transient");
        }
      },
    }));
    const { service, failures } = recordingFailedJobs();

    await runQueueJob(
      { name: "test.recovers", payload: {} },
      overrideQueueRecorder(persistence, service),
    );

    expect(calls).toBe(2);
    expect(failures).toEqual([]);
  });

  queueTest("a single-attempt job records the failure immediately", async (persistence) => {
    jobRegistry.register("test.single", () => ({
      maxAttempts: 1,
      backoffMs: 0,
      handle: async () => {
        throw new Error("nope");
      },
    }));
    const { service, failures } = recordingFailedJobs();

    await expect(
      runQueueJob(
        { name: "test.single", payload: {} },
        overrideQueueRecorder(persistence, service),
      ),
    ).rejects.toThrow("nope");

    expect(failures).toHaveLength(1);
  });

  queueTest("the recorded failure carries the payload and a stack", async (persistence) => {
    jobRegistry.register("test.payload", () => ({
      maxAttempts: 1,
      backoffMs: 0,
      handle: async () => {
        throw new Error("with-stack");
      },
    }));
    const captured: Array<Record<string, unknown>> = [];
    const service = {
      recordFailure: async (input: Record<string, unknown>) => {
        captured.push(input);
      },
    };

    await expect(
      runQueueJob(
        { name: "test.payload", payload: { id: 7 } },
        overrideQueueRecorder(persistence, service),
      ),
    ).rejects.toThrow();

    expect(captured[0]?.payload).toEqual({ id: 7 });
    expect(String(captured[0]?.exception)).toContain("with-stack");
  });

  queueTest("an unknown job name throws rather than silently passing", async (persistence) => {
    const { service } = recordingFailedJobs();

    await expect(
      runQueueJob(
        { name: "test.does-not-exist", payload: {} },
        overrideQueueRecorder(persistence, service),
      ),
    ).rejects.toThrow(/Unknown job/);
  });
});
