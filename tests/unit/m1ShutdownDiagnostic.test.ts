/** Isolated file: changed metadata ownership must block retry until process recovery. */
import { expect, test } from "bun:test";
import { collectProviders } from "@getstrata/bootstrap/context";
import { startGuardedApplication } from "../../src/bootstrap/m1/application";
import { describeM1Failure } from "../../src/bootstrap/m1/diagnostics";
import { routeRegistry } from "../../src/bootstrap/routeRegistry";

test("metadata restoration failure has a safe shutdown diagnostic and memoized result", async () => {
  const providers = collectProviders([]).filter((provider) =>
    ["core.config", "core.cache", "core.storage", "core.auth", "core.policy"].includes(
      provider.name,
    ),
  );
  let closes = 0;
  const app = await startGuardedApplication({
    providers: [
      ...providers,
      {
        name: "owned",
        register({ onCleanup }) {
          onCleanup(() => {
            closes++;
          });
        },
      },
    ],
    modules: [],
  });
  try {
    routeRegistry.register({ method: "GET", path: "/foreign", middleware: [] });
    const retained = routeRegistry.list();
    const stopping = app.shutdown();
    const result = await stopping;
    expect(app.shutdown("OTHER")).toBe(stopping);
    expect(await app.shutdown()).toBe(result);
    expect(result.successful).toBe(false);
    expect(result.timedOut).toBe(false);
    expect(result.errors).toHaveLength(1);
    const failure = result.errors[0];
    expect(failure?.name).toBe("m1:metadata");
    expect(failure?.phase).toBe("close");
    const error = failure?.error;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      "Route metadata ownership changed; previous snapshot was not restored.",
    );
    expect(describeM1Failure(error)).toEqual({
      stage: "shutdown",
      code: "metadata-ownership-changed",
      field: "routes",
      owner: "application",
    });
    expect(Object.isFrozen(describeM1Failure(error))).toBe(true);
    let reads = 0;
    Object.defineProperty(error, "message", {
      get() {
        reads++;
        return "/private/report?credential=owned-sensitive-fixture";
      },
    });
    expect(JSON.stringify(describeM1Failure(error))).not.toContain("credential");
    expect(reads).toBe(0);
    expect(app.shutdown()).toBe(stopping);
    expect((await app.shutdown()).errors[0]?.error).toBe(error);
    expect(closes).toBe(1);
    expect(routeRegistry.list()).toEqual(retained);
    await expect(startGuardedApplication({ providers, modules: [] })).rejects.toThrow(
      "already active",
    );
    expect(routeRegistry.list()).toEqual(retained);
  } finally {
    await app.server.stop(true);
  }
});
