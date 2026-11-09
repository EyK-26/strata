import assert from "node:assert/strict";
import { realpath } from "node:fs/promises";
import { join } from "node:path";
import {
  bounded,
  deferred,
  listenerFixture,
  pending,
  rejected,
  resource,
} from "./applicationOwnershipSupport.ts";

const mode = process.argv[2] ?? "packed";
assert.ok(["packed", "source-import", "ignored-failures", "pending-stop"].includes(mode));

let importEffects = 0;
const originalServe = Bun.serve;
const originalInterval = globalThis.setInterval;
const originalWorker = globalThis.Worker;
const originalOn = process.on;
const originalOnce = process.once;
const signalsBefore = [process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")];
Bun.serve = (() => {
  importEffects++;
  throw new Error("Listener acquired during import/construction");
}) as typeof Bun.serve;
globalThis.setInterval = (() => {
  importEffects++;
  throw new Error("Producer started during import/construction");
}) as typeof setInterval;
globalThis.Worker = (() => {
  importEffects++;
  throw new Error("Worker started during import/construction");
}) as unknown as typeof Worker;
for (const method of ["on", "once"] as const) {
  const original = process[method];
  process[method] = function (this: typeof process, event: string | symbol, ...args: unknown[]) {
    if (event === "SIGINT" || event === "SIGTERM") {
      importEffects++;
      throw new Error("Signal owner installed during import/construction");
    }
    return Reflect.apply(original, this, [event, ...args]);
  } as typeof original;
}

const { createApplication } = await import("@getstrata/core/runtime/application");
let setupCalls = 0;
const unstarted = createApplication({
  providers: [
    {
      name: "same",
      setup() {
        setupCalls++;
      },
    },
  ],
});
assert.equal(importEffects, 0);
assert.equal(setupCalls, 0);
assert.equal(unstarted.state.cleanup, "not-required");
assert.deepEqual(
  [process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")],
  signalsBefore,
);
Bun.serve = originalServe;
globalThis.setInterval = originalInterval;
globalThis.Worker = originalWorker;
process.on = originalOn;
process.once = originalOnce;
await unstarted.stop();
await rejected(unstarted.start());

if (mode === "source-import") {
  console.log(JSON.stringify({ mode, importEffects, noDatabaseRuntimeWitness: true }));
} else if (mode === "packed") {
  const resolved = await realpath(
    new URL(import.meta.resolve("@getstrata/core/runtime/application")),
  );
  const installed = await realpath(join(process.cwd(), "node_modules/@getstrata/core"));
  assert.ok(
    resolved.startsWith(`${installed}/`),
    `Consumer loaded an external source path: ${resolved}`,
  );
  assert.equal(
    installed,
    join(process.cwd(), "node_modules/@getstrata/core"),
    "Installed package must not be a workspace symlink",
  );
  const events: string[] = [];
  let app!: ReturnType<typeof createApplication>;
  const listener = listenerFixture(
    () => app,
    (scope) => new Response(String(scope.config.value)),
  );
  app = createApplication({
    config: { value: "packed-owner" },
    providers: [
      {
        name: "same",
        async setup(scope) {
          await scope.acquire(resource("same", events));
        },
      },
    ],
    transports: [listener.transport],
  });
  try {
    const original = app.start();
    await bounded(original);
    const port = listener.server?.port;
    assert.ok(port);
    assert.equal(await (await fetch(listener.url())).text(), "packed-owner");
    assert.equal(await app.run((scope) => scope.config.value), "packed-owner");
    const stop = await bounded(app.stop());
    assert.equal(stop.successful, true);
    assert.equal((await app.completion).snapshot.cleanup, "clean");
    await rejected(app.start());
    await original;
    assert.equal(events.filter((value) => value === "same.close").length, 1);
    assert.equal(listener.acquired, 1);
    assert.equal(listener.closeCalls, 1);
    const witness = Bun.serve({
      hostname: "127.0.0.1",
      port,
      fetch: () => new Response("rebound"),
    });
    await witness.stop(true);
    console.log(
      JSON.stringify({
        mode,
        resolved,
        importEffects,
        http: true,
        command: true,
        cleanup: "clean",
        rebind: true,
      }),
    );
  } finally {
    await listener.recover();
    await bounded(app.stop());
  }
} else if (mode === "pending-stop") {
  const gate = deferred();
  const entered = deferred();
  let closed = 0;
  const app = createApplication({
    shutdownTimeoutMs: 25,
    providers: [
      {
        name: "same",
        async setup(scope) {
          await scope.acquire({
            name: "same",
            open: () => ({ ok: true, value: 1 }),
            close() {
              closed++;
            },
          });
          entered.resolve();
          await gate.promise;
          assert.equal(closed, 0);
        },
      },
    ],
  });
  void app.start();
  try {
    await bounded(entered.promise);
    const stop = await bounded(app.stop());
    assert.equal(stop.timedOut, true);
    await pending(app.completion);
    assert.equal(closed, 0);
    gate.resolve();
    assert.equal((await bounded(app.completion)).snapshot.cleanup, "clean");
    assert.equal(closed, 1);
    console.log(JSON.stringify({ mode, timeoutWasPending: true, cleanupAfterRelease: "clean" }));
  } finally {
    gate.resolve();
    await bounded(app.completion);
  }
} else {
  const unhandled: unknown[] = [];
  process.on("unhandledRejection", (error) => {
    unhandled.push(error);
  });
  const immediate = createApplication({
    providers: [
      {
        name: "same",
        setup() {
          throw undefined;
        },
      },
    ],
  });
  void immediate.start();
  await bounded(immediate.completion);
  const open = deferred<never>();
  const entered = deferred();
  const lateOpen = createApplication({
    shutdownTimeoutMs: 25,
    providers: [
      {
        name: "same",
        async setup(scope) {
          await scope.acquire({
            name: "same",
            open() {
              entered.resolve();
              return open.promise;
            },
            close() {},
          });
        },
      },
    ],
  });
  void lateOpen.start();
  await entered.promise;
  assert.equal((await bounded(lateOpen.stop())).timedOut, true);
  open.reject(new Error("ignored late open"));
  await bounded(lateOpen.completion);
  const close = deferred();
  const lateClose = createApplication({
    shutdownTimeoutMs: 25,
    providers: [
      {
        name: "same",
        async setup(scope) {
          await scope.acquire({
            name: "same",
            open: () => ({ ok: true, value: 1 }),
            close() {
              return close.promise;
            },
          });
        },
      },
    ],
  });
  await lateClose.start();
  assert.equal((await bounded(lateClose.stop())).timedOut, true);
  close.reject(new Error("ignored late close"));
  // Deliberately never observe lateClose.completion: owner must still handle failure.
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(lateClose.state.cleanup, "failed");
  assert.deepEqual(unhandled, []);
  console.log(JSON.stringify({ mode, unhandled: 0, lateFailureObserved: true }));
}
