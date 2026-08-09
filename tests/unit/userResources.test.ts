import { describe, expect, test } from "bun:test";
import { toUserResource } from "../../src/modules/user/resources";
import type { UserRecord } from "../../src/modules/user/types";

describe("user resources", () => {
  test("toUserResource maps user records to API resources", () => {
    const record: UserRecord = {
      id: 1,
      name: "Admin User",
      email: "admin@workhub.test",
      role: "admin",
      tenant_id: 1,
      created_at: new Date("2026-01-01T00:00:00.000Z"),
      updated_at: new Date("2026-01-01T00:00:00.000Z"),
    };

    expect(toUserResource(record)).toEqual({
      id: 1,
      name: "Admin User",
      email: "admin@workhub.test",
      role: "admin",
    });
  });
});
