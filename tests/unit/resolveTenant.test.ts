import { describe, expect, test } from "bun:test";
import { resolveTenant } from "@getstrata/core/tenant/resolveTenant";
import { restoreEnvVar } from "../helpers/restoreEnv";

describe("resolveTenant", () => {
  test("loads the seeded default tenant", async () => {
    const tenant = await resolveTenant(1);

    expect(tenant).toMatchObject({
      id: 1,
      slug: "default",
      plan: "enterprise",
    });
  });

  test("returns a synthetic tenant when TENANCY_DRIVER=none", async () => {
    const previous = process.env.TENANCY_DRIVER;
    process.env.TENANCY_DRIVER = "none";

    try {
      await expect(resolveTenant(9)).resolves.toEqual({
        id: 9,
        slug: "default",
        plan: "free",
        region: "eu",
      });
    } finally {
      restoreEnvVar("TENANCY_DRIVER", previous);
    }
  });
});
