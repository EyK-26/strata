import assert from "node:assert/strict";
import type {
  Application,
  CommandScope,
  OpenOutcome,
  ResourceSpec,
  TransportDefinition,
} from "@getstrata/core/runtime/application";

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error?: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

async function bounded<T>(promise: Promise<T>, label = "operation", timeoutMs = 2000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} did not settle`)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function rejected(promise: Promise<unknown>): Promise<unknown> {
  const outcome = await bounded(
    promise.then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    ),
  );
  assert.equal(outcome.ok, false, "Expected rejection");
  if (outcome.ok) assert.fail("Expected rejection");
  return outcome.error;
}

async function pending(promise: Promise<unknown>) {
  const marker = Symbol("still pending");
  const observed = await Promise.race([
    promise.then(
      () => "fulfilled",
      () => "rejected",
    ),
    new Promise<typeof marker>((resolve) => setImmediate(() => resolve(marker))),
  ]);
  assert.equal(observed, marker, "Actual owned operation must still be pending");
}

function resource(name: string, events: string[], extra: Partial<ResourceSpec<string>> = {}) {
  const spec: ResourceSpec<string> = {
    name,
    open: () => {
      events.push(`${name}.open`);
      return { ok: true, value: name };
    },
    stop: () => {
      events.push(`${name}.stop`);
    },
    drain: () => {
      events.push(`${name}.drain`);
    },
    flush: () => {
      events.push(`${name}.flush`);
    },
    close: () => {
      events.push(`${name}.close`);
    },
    ...extra,
  };
  return spec;
}

type OwnedServer = Bun.Server<undefined>;

/** Test adapter only: a real socket plus explicit app-owned handler work. */
function listenerFixture(
  app: () => Application,
  handler: (scope: CommandScope) => Response | Promise<Response>,
  options: { port?: number; stop?: (server: OwnedServer) => void | Promise<void> } = {},
) {
  let server: OwnedServer | undefined;
  let acquired = 0;
  let stopCalls = 0;
  let closeCalls = 0;
  const transport: TransportDefinition = {
    name: "http",
    async setup(scope) {
      await scope.acquire<OwnedServer>({
        name: "listener",
        open(): OpenOutcome<OwnedServer> {
          try {
            server = Bun.serve<undefined>({
              hostname: "127.0.0.1",
              port: options.port ?? 0,
              fetch() {
                return app()
                  .run(handler)
                  .catch(() => new Response("closed admission", { status: 503 }));
              },
            });
            acquired++;
            return { ok: true, value: server };
          } catch (error) {
            // Bun's constructor returned no server; the caller-owned occupier is untouched.
            return { ok: false, error, disposition: "not-acquired" };
          }
        },
        async stop(value) {
          stopCalls++;
          if (options.stop) await options.stop(value);
          else await value.stop(false);
        },
        async close(value) {
          closeCalls++;
          await value.stop(true);
        },
      });
    },
  };
  return {
    transport,
    get server() {
      return server;
    },
    get acquired() {
      return acquired;
    },
    get stopCalls() {
      return stopCalls;
    },
    get closeCalls() {
      return closeCalls;
    },
    url() {
      assert.ok(server);
      return server.url;
    },
    async recover() {
      await server?.stop(true);
    },
  };
}

export { bounded, deferred, listenerFixture, pending, rejected, resource };
