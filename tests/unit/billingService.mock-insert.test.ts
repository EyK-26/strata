import { afterEach, describe, expect, test } from "bun:test";
import { resetDatabaseConnectionForTests } from "../../src/db/connection";
import BillingService from "../../src/modules/billing/service";
import { createMockDatabaseConnection, restoreDefaultDatabaseConnection } from "./testHelpers";

describe("BillingService insert guard", () => {
  afterEach(async () => {
    await restoreDefaultDatabaseConnection();
  });

  test("throws when subscription insert does not return a row", async () => {
    const mockConnection = createMockDatabaseConnection(async (strings) => {
      const query = strings.join("");

      if (query.includes("FROM subscription") && query.includes("WHERE tenant_id")) {
        return [];
      }

      if (query.includes("INSERT INTO subscription")) {
        return [];
      }

      if (query.includes("UPDATE tenant")) {
        return [];
      }

      return [];
    });

    resetDatabaseConnectionForTests(mockConnection as never);
    const service = new BillingService();

    await expect(service.upsertSubscription({ tenantId: 1, plan: "pro" })).rejects.toThrow(
      "Subscription insert did not return a row.",
    );
  });
});
