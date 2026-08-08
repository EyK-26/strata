import { describe, expect, test } from "bun:test";
import { userFactory } from "../../src/modules/user/factory";

describe("UserFactory", () => {
  test("builds overridable user records", () => {
    const user = userFactory.make({
      name: "Taylor",
      role: "admin",
    });

    expect(user.name).toBe("Taylor");
    expect(user.role).toBe("admin");
    expect(user.email).toContain("@workhub.test");
  });
});
