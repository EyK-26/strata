import { afterEach, describe, expect, test } from "bun:test";
import { resetDatabaseConnectionForTests } from "../../src/db/connection";
import BillingService from "../../src/modules/billing/service";
import { createMockDatabaseConnection, restoreDefaultDatabaseConnection } from "./testHelpers";

describe("BillingService update guard", () => {
  afterEach(async () => {
    await restoreDefaultDatabaseConnection();
  });

  test("throws when subscription update does not return a row", async () => {
    const existing = {
      id: 10,
      tenant_id: 1,
      stripe_subscription_id: null,
      plan: "free" as const,
      status: "active" as const,
      current_period_end: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    const mockConnection = createMockDatabaseConnection(async (strings) => {
      const query = strings.join("");

      if (query.includes("FROM subscription") && query.includes("WHERE tenant_id")) {
        return [existing];
      }

      if (query.includes("UPDATE subscription")) {
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
      "Subscription update did not return a row.",
    );
  });
});
