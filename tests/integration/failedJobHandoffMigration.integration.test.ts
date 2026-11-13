import { expect, test } from "bun:test";
import { createQueueHandoff } from "@getstrata/core/queue/queueHandoff";
import migration from "../../src/db/migrations/0039_add_failed_job_handoff";
import { withPostgresProvisioningFixture } from "../helpers/postgresProvisioningFixture";

test.skipIf(!process.env.MIGRATION_DATABASE_URL)(
  "failed-job handoff migration preserves populated PostgreSQL recovery and rolls back only its nullable text column",
  async () => {
    await withPostgresProvisioningFixture(async ({ admin }) => {
      await admin.unsafe(
        "CREATE TABLE failed_job(id INTEGER PRIMARY KEY,job_name TEXT NOT NULL,job_id TEXT,payload JSONB NOT NULL); INSERT INTO failed_job VALUES(1,'owned-job','existing-id','{\"nested\":{\"value\":7}}'::jsonb)",
      );
      await migration.up(admin);
      expect(
        Array.from(await admin.unsafe("SELECT id,job_id,payload,handoff FROM failed_job")),
      ).toEqual([
        { id: 1, job_id: "existing-id", payload: { nested: { value: 7 } }, handoff: null },
      ]);
      const handoff = createQueueHandoff({
        key: new Uint8Array(32).fill(37),
        audience: "migration-owner",
      });
      const payload = { nested: { value: 7 } };
      const identity = {
        actor: { kind: "principal" as const, claims: { id: 7, data: "x".repeat(16000) } },
        tenant: { id: 1 },
      };
      const token = handoff.seal("owned-job", payload, identity);
      await admin.unsafe("UPDATE failed_job SET handoff=$1 WHERE id=1", [token]);
      await admin.unsafe(
        "INSERT INTO failed_job(id,job_name,payload) VALUES(2,'system-job','{}'::jsonb)",
      );
      const rows = await admin.unsafe<
        { id: number; job_name: string; payload: Record<string, unknown>; handoff: string | null }[]
      >("SELECT id,job_name,payload,handoff FROM failed_job ORDER BY id");
      const signed = rows[0];
      if (!signed?.handoff) throw new Error("Migration lost the stored authenticated handoff");
      expect(signed.handoff).toBe(token);
      expect(
        handoff.verify({ name: signed.job_name, payload: signed.payload, handoff: signed.handoff }),
      ).toEqual(identity);
      expect(rows[1]?.handoff).toBeNull();
      await migration.down(admin);
      expect(
        Array.from(await admin.unsafe("SELECT id,job_id,payload FROM failed_job ORDER BY id")),
      ).toEqual([
        { id: 1, job_id: "existing-id", payload },
        { id: 2, job_id: null, payload: {} },
      ]);
      const columns = await admin.unsafe<{ column_name: string }[]>(
        "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='failed_job'",
      );
      expect(columns.map((column) => column.column_name)).not.toContain("handoff");
    });
  },
);
