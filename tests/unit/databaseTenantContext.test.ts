import { describe, expect, test } from "bun:test";
import { runWithMigrationBypass } from "@getstrata/core/tenant/databaseTenantContext";
import { restoreEnvVar } from "../helpers/restoreEnv";

describe("runWithMigrationBypass", () => {
  test("skips set_config when TENANCY_DRIVER=none", async () => {
    const previous = process.env.TENANCY_DRIVER;
    process.env.TENANCY_DRIVER = "none";

    try {
      await expect(runWithMigrationBypass(async () => "ok")).resolves.toBe("ok");
    } finally {
      restoreEnvVar("TENANCY_DRIVER", previous);
    }
  });

  test("skips set_config when TENANCY_DRIVER=column", async () => {
    const previous = process.env.TENANCY_DRIVER;
    process.env.TENANCY_DRIVER = "column";

    try {
      await expect(runWithMigrationBypass(async () => "ok")).resolves.toBe("ok");
    } finally {
      restoreEnvVar("TENANCY_DRIVER", previous);
    }
  });
});
