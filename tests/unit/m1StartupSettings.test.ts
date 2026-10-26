import { expect, test } from "bun:test";
import { collectProviders } from "@getstrata/bootstrap/context";
import { startGuardedApplication } from "../../src/bootstrap/m1/application";

test("invalid shutdown settings acquire neither providers nor a startup reservation", async () => {
  const previous = process.env.SHUTDOWN_TIMEOUT_MS;
  let acquired = 0;
  try {
    process.env.SHUTDOWN_TIMEOUT_MS = "invalid";
    await expect(
      startGuardedApplication({
        providers: [
          {
            name: "untouched",
            register() {
              acquired++;
            },
          },
        ],
        modules: [],
      }),
    ).rejects.toThrow(RangeError);
    expect(acquired).toBe(0);
    if (previous === undefined) delete process.env.SHUTDOWN_TIMEOUT_MS;
    else process.env.SHUTDOWN_TIMEOUT_MS = previous;
    const corrected = await startGuardedApplication({
      providers: collectProviders([]).filter((provider) =>
        ["core.config", "core.cache", "core.storage", "core.auth", "core.policy"].includes(
          provider.name,
        ),
      ),
      modules: [],
    });
    expect((await corrected.shutdown()).successful).toBe(true);
  } finally {
    if (previous === undefined) delete process.env.SHUTDOWN_TIMEOUT_MS;
    else process.env.SHUTDOWN_TIMEOUT_MS = previous;
  }
});
