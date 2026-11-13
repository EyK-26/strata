import { expect, test } from "bun:test";
import { failedJobRepository } from "@getstrata/core/queue/failedJobRepository";
import FailedJobService from "@getstrata/core/queue/failedJobService";
import { createQueueHandoff } from "@getstrata/core/queue/queueHandoff";
import { compileStarterFeatures } from "../../../packages/strata-starter/src/featurePlan";
import { defaultLayers } from "../../../packages/strata-starter/src/presets";
import { renderStarterSchemaMigration } from "../../../packages/strata-starter/src/renderMigrations";
import type { DatabaseLayer } from "../../../packages/strata-starter/src/types";
import { createNativePersistenceApplication } from "../../helpers/nativePersistenceApplication";

function failedJobSchema(database: DatabaseLayer): string {
  const source = renderStarterSchemaMigration(
    compileStarterFeatures({ ...defaultLayers(), database }),
  );
  const statement = [...source.matchAll(/await db\.unsafe\(("(?:\\.|[^"\\])*")\);/g)]
    .map((match) => JSON.parse(match[1] ?? '""') as string)
    .find((sql) => sql.startsWith("CREATE TABLE IF NOT EXISTS failed_job"));
  if (!statement) throw new Error("Generated migration omitted the failed-job table");
  return statement;
}

test.each(["postgres", "mysql", "sqlite"] as const)(
  "generated %s queue schema declares nullable text handoff alongside its native payload storage",
  (database) => {
    const statement = failedJobSchema(database);
    expect(statement).toMatch(/\n\s+handoff TEXT,\n/);
    expect(statement).not.toMatch(/handoff TEXT NOT NULL/);
    expect(statement).toContain(
      database === "postgres" ? "payload JSONB NOT NULL" : "payload TEXT NOT NULL",
    );
  },
);

test("generated SQLite schema supports unsigned and signed failed-job storage and verified manual recovery", async () => {
  const fixture = await createNativePersistenceApplication({
    default: "generated",
    connections: { generated: { driver: "sqlite", filename: ":memory:" } },
    repositories: [failedJobRepository],
  });
  const handoff = createQueueHandoff({
    key: new Uint8Array(32).fill(27),
    audience: "generated-app",
  });
  const payload = { longer: 1, a: { z: 2, b: 3 } };
  const identity = { actor: { kind: "principal" as const, claims: { id: 7 } }, tenant: { id: 1 } };
  const token = handoff.seal("generated-job", payload, identity);
  try {
    await fixture.run(async (database) => {
      await database.execute({ text: failedJobSchema("sqlite"), params: [] });
      const service = new FailedJobService(database.repository(failedJobRepository));
      const unsigned = await service.recordFailure({
        jobName: "system-job",
        payload: {},
        exception: "system failure",
      });
      expect(unsigned.handoff).toBeNull();
      const signed = await service.recordFailure({
        jobName: "generated-job",
        jobId: "stable-generated-job",
        payload,
        handoff: token,
        exception: "trusted failure",
      });
      expect(signed.handoff).toBe(token);
      let replays = 0;
      await service.retry(signed.id, async (record) => {
        if (!record.handoff) throw new Error("Generated schema lost authenticated identity");
        expect(
          handoff.verify({
            name: record.job_name,
            payload: record.payload,
            handoff: record.handoff,
          }),
        ).toEqual(identity);
        expect(record.job_id).toBe("stable-generated-job");
        replays++;
      });
      expect(replays).toBe(1);
      expect((await service.listRecent()).map((record) => record.id)).toEqual([unsigned.id]);
    });
  } finally {
    await fixture.close();
  }
});
