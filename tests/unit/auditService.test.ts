import { describe, expect, test, beforeAll } from "bun:test";
import AuditService from "../../src/modules/audit/service";
import AuditLogRepository from "../../src/modules/audit/repository";

beforeAll(async () => {
  const { freshDatabase } = await import("../../src/db/migrations/runner");
  await freshDatabase({ seed: true });
});

describe("AuditService", () => {
  test("persists audit log entries", async () => {
    const service = new AuditService(new AuditLogRepository());
    const entry = await service.record({
      action: "task.created",
      subjectType: "task",
      subjectId: 1,
      payload: { title: "Test" },
    });

    expect(entry.action).toBe("task.created");
    expect(entry.subject_id).toBe(1);
  });
});
