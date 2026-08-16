import { describe, expect, test } from "bun:test";
import { runWithAuthUser } from "@getstrata/core/auth/authContext";
import { AuthManager, GuestGuard } from "@getstrata/core/auth/guard";
import { PolicyGate } from "@getstrata/core/auth/policy";
import OrganizationPolicy from "../../src/modules/organization/policy";
import type { OrganizationRecord } from "../../src/modules/organization/types";

describe("policy integration with auth context", () => {
  test("uses the current authenticated user when authorizing", async () => {
    const gate = new PolicyGate();
    gate.register("organization", new OrganizationPolicy());

    await runWithAuthUser({ id: 1, role: "admin" }, async () => {
      expect(() => gate.authorize("organization", "create")).not.toThrow();
    });
  });

  test("still evaluates model policies without an authenticated user", () => {
    const gate = new PolicyGate();
    gate.register("organization", new OrganizationPolicy());
    const organization = {
      id: 2,
      slug: "protected-org",
    } as OrganizationRecord;

    expect(gate.allows("organization", "delete", null, organization)).toBe(false);
  });

  test("allows admins to delete protected organizations", () => {
    const gate = new PolicyGate();
    gate.register("organization", new OrganizationPolicy());
    const organization = {
      id: 2,
      slug: "protected-org",
    } as OrganizationRecord;

    expect(gate.allows("organization", "delete", { id: 1, role: "admin" }, organization)).toBe(
      true,
    );
  });
});

describe("AuthManager with PolicyGate", () => {
  test("requireUser integrates with route handlers via auth context", async () => {
    const auth = new AuthManager(new GuestGuard());

    await expect(
      runWithAuthUser(null, async () => {
        await auth.requireUser();
      }),
    ).rejects.toThrow();
  });
});
