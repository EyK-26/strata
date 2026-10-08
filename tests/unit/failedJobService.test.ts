import { describe, expect, test } from "bun:test";
import { FailedJobService } from "@getstrata/core/queue/failedJobService";
import type { FailedJobRecord } from "@getstrata/core/queue/types";

function createRepositoryStub(initial: FailedJobRecord[] = []) {
  const records = [...initial];

  return {
    create: async (input: Omit<FailedJobRecord, "id">) => {
      const record: FailedJobRecord = {
        id: records.length + 1,
        ...input,
      };
      records.push(record);
      return record;
    },
    findAll: async () => [...records],
    findByIdOrThrow: async (id: number, onMissing: (id: number) => Error) => {
      const record = records.find((entry) => entry.id === id);
      if (!record) {
        throw onMissing(id);
      }
      return record;
    },
    deleteById: async (id: number) => {
      const index = records.findIndex((entry) => entry.id === id);
      if (index === -1) {
        return false;
      }
      records.splice(index, 1);
      return true;
    },
  };
}

describe("FailedJobService", () => {
  test("records failures with timestamps", async () => {
    const service = new FailedJobService(createRepositoryStub() as never);

    const record = await service.recordFailure({
      jobName: "webhooks.dispatch",
      payload: { id: 1 },
      exception: "boom",
    });

    expect(record.job_name).toBe("webhooks.dispatch");
    expect(record.failed_at).toBeInstanceOf(Date);
  });

  test("lists recent failures in descending order", async () => {
    const service = new FailedJobService(
      createRepositoryStub([
        {
          id: 1,
          job_name: "older",
          payload: {},
          exception: "boom",
          failed_at: new Date("2026-01-01T00:00:00.000Z"),
        },
      ]) as never,
    );

    const listed = await service.listRecent(10);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.job_name).toBe("older");
  });

  test("retry removes the failed job only after admission succeeds", async () => {
    const repository = createRepositoryStub([
      {
        id: 4,
        job_name: "test.retry",
        payload: { marker: "x" },
        exception: "boom",
        failed_at: new Date(),
      },
    ]);
    const service = new FailedJobService(repository as never);

    let admitted = false;
    const retried = await service.retry(4, async (record) => {
      expect(record.id).toBe(4);
      expect(await repository.findAll()).toHaveLength(1);
      admitted = true;
    });
    expect(admitted).toBe(true);
    expect(retried.job_name).toBe("test.retry");
    expect(await repository.findAll()).toEqual([]);
  });

  test("failed admission and unknown handlers retain recovery records", async () => {
    const repository = createRepositoryStub([
      { id: 5, job_name: "retained", payload: {}, exception: "boom", failed_at: new Date() },
    ]);
    const service = new FailedJobService(repository as never);
    for (const reason of ["Redis unavailable", "Unknown job"]) {
      await expect(
        service.retry(5, async () => {
          throw new Error(reason);
        }),
      ).rejects.toThrow(reason);
      expect(await repository.findAll()).toHaveLength(1);
    }
  });

  test("recovery-record deletion failure happens after admission and leaves replay available", async () => {
    const repository = createRepositoryStub([
      { id: 6, job_name: "retained", payload: {}, exception: "boom", failed_at: new Date() },
    ]);
    let admitted = 0;
    const service = new FailedJobService({
      ...repository,
      deleteById: async () => {
        expect(admitted).toBe(1);
        throw new Error("SQL unavailable");
      },
    } as never);
    await expect(
      service.retry(6, async () => {
        admitted++;
      }),
    ).rejects.toThrow("SQL unavailable");
    expect(await repository.findAll()).toHaveLength(1);
  });

  test("missing admission callbacks refuse legacy destructive retries", async () => {
    const service = new FailedJobService(createRepositoryStub() as never);
    // @ts-expect-error Legacy one-argument retry must fail closed for JavaScript callers too.
    await expect(service.retry(1)).rejects.toThrow("requires an admission callback");
  });

  test("flush deletes all failed jobs", async () => {
    const repository = createRepositoryStub([
      {
        id: 1,
        job_name: "one",
        payload: {},
        exception: "boom",
        failed_at: new Date(),
      },
      {
        id: 2,
        job_name: "two",
        payload: {},
        exception: "boom",
        failed_at: new Date(),
      },
    ]);
    const service = new FailedJobService(repository as never);

    expect(await service.flush()).toBe(2);
    expect(await repository.findAll()).toEqual([]);
  });

  test("delete removes a failed job by id", async () => {
    const repository = createRepositoryStub([
      {
        id: 3,
        job_name: "delete.me",
        payload: {},
        exception: "boom",
        failed_at: new Date(),
      },
    ]);
    const service = new FailedJobService(repository as never);

    await service.delete(3);
    expect(await repository.findAll()).toEqual([]);
  });

  test("flush skips jobs that cannot be deleted", async () => {
    const repository = {
      findAll: async () => [
        {
          id: 1,
          job_name: "one",
          payload: {},
          exception: "boom",
          failed_at: new Date(),
        },
      ],
      deleteById: async () => false,
    };

    const service = new FailedJobService(repository as never);
    expect(await service.flush()).toBe(0);
  });
});
