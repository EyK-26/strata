import { describe, expect, test } from "bun:test";
import { runWithTenantDatabase } from "../../src/core/tenant/tenantDatabaseScope";
import { DEFAULT_TENANT } from "../../src/core/tenant/tenantMiddleware";
import AuditLogRepository from "../../src/modules/audit/repository";
import AuditService from "../../src/modules/audit/service";

describe("AuditService", () => {
  test("persists audit log entries", async () => {
    await runWithTenantDatabase(DEFAULT_TENANT, async () => {
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
});
