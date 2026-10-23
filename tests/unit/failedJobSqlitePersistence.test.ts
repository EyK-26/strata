import { expect, test } from "bun:test";
import { createBunSqlPool } from "@getstrata/core/database/bunSql";
import { runWithSqlDialect } from "@getstrata/core/database/dialect";
import FailedJobRepository from "@getstrata/core/queue/failedJobRepository";
import FailedJobService from "@getstrata/core/queue/failedJobService";

test("native SQLite stores and replays the declared JSON payload and failure timestamp", async () => {
  const sql = createBunSqlPool({ url: "sqlite::memory:" });
  try {
    await runWithSqlDialect("sqlite", async () => {
      // Fixture schema; recording, reads, admission and deletion use the public service/repository.
      await sql.unsafe(
        "CREATE TABLE failed_job(id INTEGER PRIMARY KEY,job_name TEXT NOT NULL,job_id TEXT,payload TEXT NOT NULL,exception TEXT NOT NULL,failed_at DATETIME NOT NULL)",
      );
      const service = new FailedJobService(new FailedJobRepository().withConnection(sql));
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
      await service.retry(record.id, async (recovered) => {
        expect(recovered.job_id).toBe("stable-logical-id");
        expect(recovered.payload).toEqual(payload);
        expect(await service.listRecent()).toHaveLength(1);
      });
      expect(await service.listRecent()).toEqual([]);
    });
  } finally {
    await sql.close();
  }
});
