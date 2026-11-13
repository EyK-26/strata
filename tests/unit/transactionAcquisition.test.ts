import { expect, test } from "bun:test";
import { resourceService } from "@getstrata/core/contracts/services";
import type { ServiceToken } from "@getstrata/core/contracts/token";
import { createDatabaseBindings } from "@getstrata/core/database/bindings";
import type { RawPool } from "@getstrata/core/database/driverPorts";
import { createRawPostgresPoolFromNative } from "@getstrata/core/database/rawPostgres";
import { DATABASE_SESSION_TOKEN } from "@getstrata/core/database/tokens";
import { createApplication } from "@getstrata/core/runtime/application";

// Other former global acquisition cases map to databaseSessions/native protocol in LEDGER.txt.
test("an admitted canonical body survives acquisition abort and uses one checkout through savepoint and observers", async () => {
  const controller = new AbortController();
  const calls: string[] = [];
  const native = {
    async unsafe(text: string) {
      calls.push(text);
      return Object.assign([], {
        command: text.startsWith("ROLLBACK")
          ? "ROLLBACK"
          : text.startsWith("RELEASE")
            ? "RELEASE"
            : text.startsWith("SAVEPOINT")
              ? "SAVEPOINT"
              : text,
      });
    },
    async reserve() {
      calls.push("reserve");
      return {
        ...native,
        release() {
          calls.push("release");
        },
        async close() {
          calls.push("discard");
        },
      };
    },
    async close() {
      calls.push("pool.close");
    },
  };
  const services = createDatabaseBindings({
    default: "main",
    connections: { main: { driver: "sqlite", filename: ":memory:" } },
  });
  const resource = services.find((item) => item.kind === "resource");
  if (resource?.kind !== "resource") throw Error("Missing fixture resource");
  const app = createApplication({
    providers: [],
    services,
    overrides: [
      resourceService(resource.token as ServiceToken<RawPool>, {
        lifetime: "application",
        dependencies: resource.dependencies,
        create: () => ({
          name: "synthetic-native-PG",
          open: () => ({ ok: true, value: createRawPostgresPoolFromNative(native) }),
          close: (pool) => pool.close(),
        }),
      }),
    ],
  });
  const failures: unknown[] = [];
  try {
    await app.start();
    const result = await app.run((scope) =>
      scope.resolve(DATABASE_SESSION_TOKEN).transaction(
        async (selected) => {
          controller.abort(new Error("checkout-only signal"));
          await selected.execute({ text: "SELECT outer", params: [] });
          const child = await selected.transaction(async (nested) => {
            await nested.execute({ text: "SELECT child", params: [] });
            nested.afterCommit(() => {
              calls.push("observer.child");
            });
            return 11;
          });
          expect(child).toBe(11);
          selected.afterCommit(() => {
            expect(calls.at(-1)).toBe("observer.child");
            calls.push("observer.parent");
          });
          return 42;
        },
        { acquisitionSignal: controller.signal },
      ),
    );
    expect(result).toBe(42);
    expect(controller.signal.aborted).toBe(true);
    expect(calls.filter((call) => call === "reserve")).toHaveLength(1);
    expect(calls.filter((call) => call === "release")).toHaveLength(1);
    expect(calls.some((call) => call.startsWith("SAVEPOINT "))).toBe(true);
    expect(calls.slice(-4)).toEqual(["COMMIT", "release", "observer.child", "observer.parent"]);
  } catch (error) {
    failures.push(error);
  } finally {
    try {
      const stop = await app.stop();
      if (!stop.successful)
        failures.push(new Error("Acquisition fixture cleanup failed", { cause: stop }));
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length) throw new AggregateError(failures, "Acquisition fixture and cleanup failed");
});
