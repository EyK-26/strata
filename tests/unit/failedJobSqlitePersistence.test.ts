import { expect, test } from "bun:test";
import { failedJobRepository } from "@getstrata/core/queue/failedJobRepository";
import FailedJobService from "@getstrata/core/queue/failedJobService";
import { createQueuePersistenceFixture } from "../helpers/queuePersistence";

test("native SQLite stores and replays the declared JSON payload and failure timestamp", async () => {
  const fixture = await createQueuePersistenceFixture();
  try {
    await fixture.run(async (database) => {
      const repository = database.repository(failedJobRepository);
      const service = new FailedJobService(repository);
      const payload = { event: "orders.created", nested: { message: "Préparation", count: 3 } };
      const record = await service.recordFailure({
        jobName: "owned-fixture",
        jobId: "stable-logical-id",
        payload,
        exception: "HTTP 503",
      });
      expect(record.payload).toEqual(payload);
      expect(record.failed_at).toBeInstanceOf(Date);
      const listed = await service.listRecent();
      expect(listed).toHaveLength(1);
      expect(listed[0]?.payload).toEqual(payload);
      const projected = await repository.findAll({
        select: [{ kind: "column", table: "failed_job", column: "id" }],
      });
      expect(projected.map((row) => ({ keys: Object.keys(row).sort(), id: row.id }))).toEqual([
        { keys: ["id"], id: record.id },
      ]);
      const aliases = await repository.findAll({
        select: [
          { kind: "literalText", value: "not JSON", as: "payload" },
          { kind: "literalText", value: "not a date", as: "failed_at" },
        ],
      });
      expect(JSON.stringify(aliases)).toBe(
        JSON.stringify([{ payload: "not JSON", failed_at: "not a date" }]),
      );
      await service.retry(record.id, async (recovered) => {
        expect(recovered.job_id).toBe("stable-logical-id");
        expect(recovered.payload).toEqual(payload);
        expect(await service.listRecent()).toHaveLength(1);
      });
      expect(await service.listRecent()).toEqual([]);
    });
  } finally {
    expect((await fixture.application.stop()).successful).toBe(true);
  }
});
