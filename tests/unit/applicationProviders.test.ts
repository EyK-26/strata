import { test } from "bun:test";
import assert from "node:assert/strict";
import { createServiceToken } from "@getstrata/core/contracts/token";
import {
  createApplication,
  defineProvider,
  type ProviderScope,
  resourceService,
  valueService,
} from "@getstrata/core/runtime/application";

test("provider bindings compile once; every setup precedes boot and transports", async () => {
  const token = createServiceToken<number>("provider.value");
  const calls: string[] = [];
  let expired: ProviderScope | undefined;
  const app = createApplication({
    providers: [
      defineProvider({
        name: "second",
        requires: ["first"],
        setup(scope) {
          assert.equal(scope.resolve(token), 42);
          calls.push("second.setup");
        },
        boot() {
          calls.push("second.boot");
        },
      }),
      defineProvider({
        name: "first",
        services: [valueService(token, 42)],
        setup(scope) {
          expired = scope;
          calls.push("first.setup");
        },
        boot(scope) {
          assert.throws(() => expired?.resolve(token));
          assert.equal(scope.resolve(token), 42);
          calls.push("first.boot");
        },
      }),
    ],
    transports: [
      {
        name: "transport",
        setup() {
          calls.push("transport");
        },
      },
    ],
  });
  await app.start();
  await app.start();
  assert.deepEqual(calls, [
    "first.setup",
    "second.setup",
    "first.boot",
    "second.boot",
    "transport",
  ]);
  assert.equal((await app.stop()).successful, true);
});

test("provider declarations snapshot inputs and use graph duplicate/override rules", async () => {
  const token = createServiceToken<number>("provider.value");
  const services = [valueService(token, 1)];
  const options = {
    name: "provider",
    services,
    boot: (): void => {
      throw new Error("mutated");
    },
  };
  options.boot = () => {};
  const provider = defineProvider(options);
  services.push(valueService(token, 2));
  options.boot = () => {
    throw new Error("mutated");
  };
  assert.equal(Object.isFrozen(provider), true);
  assert.throws(
    () => createApplication({ providers: [provider], services: [valueService(token, 3)] }),
    /DUPLICATE/,
  );
  assert.throws(() => createApplication({ providers: [provider, provider] }), /Duplicate provider/);
  const app = createApplication({ providers: [provider], overrides: [valueService(token, 4)] });
  await app.start();
  assert.equal(await app.run((scope) => scope.resolve(token)), 4);
  await app.stop();
});

test("failed setup skips all boot hooks and cleans graph-owned resources", async () => {
  const token = createServiceToken<object>("owned");
  const calls: string[] = [];
  const failure = new Error("setup failed");
  const app = createApplication({
    providers: [
      defineProvider({
        name: "owner",
        services: [
          resourceService(token, {
            lifetime: "application",
            dependencies: [],
            create: () => ({
              name: "resource",
              open: () => ({ ok: true, value: {} }),
              close() {
                calls.push("close");
              },
            }),
          }),
        ],
        boot() {
          calls.push("boot");
        },
      }),
      defineProvider({
        name: "failure",
        setup() {
          throw failure;
        },
      }),
    ],
  });
  await assert.rejects(app.start(), (error) => error === failure);
  assert.deepEqual(calls, ["close"]);
  assert.equal((await app.completion).successful, true);
});

test("boot failure cleans resources acquired through its provider owner", async () => {
  const calls: string[] = [];
  const failure = new Error("boot failed");
  const app = createApplication({
    providers: [
      defineProvider({
        name: "owner",
        async boot(scope) {
          await scope.acquire({
            name: "boot-resource",
            open: () => ({ ok: true, value: {} }),
            close() {
              calls.push("close");
            },
          });
          throw failure;
        },
      }),
    ],
    transports: [
      {
        name: "transport",
        setup() {
          calls.push("transport");
        },
      },
    ],
  });
  await assert.rejects(app.start(), (error) => error === failure);
  assert.deepEqual(calls, ["close"]);
  assert.equal((await app.completion).successful, true);
});

test("invalid provider hooks and declarations fail before startup", () => {
  assert.throws(
    () => createApplication({ providers: [{ name: "bad", setup() {}, services: {} as never }] }),
    /services must be an array/,
  );
  assert.throws(
    () => createApplication({ providers: [{ name: "bad", setup() {}, boot: 1 as never }] }),
    /boot must be a function/,
  );
  assert.throws(() => defineProvider({ name: "" }), /nonempty/);
  assert.throws(() => defineProvider({ name: "bad", boot: 1 as never }), /hooks/);
  assert.throws(() => defineProvider({ name: "bad", setup: 1 as never }), /hooks/);
  assert.throws(() => defineProvider({ name: "bad", requires: "first" as never }), /dependencies/);
  assert.throws(() => defineProvider({ name: "bad", requires: [""] }), /dependencies/);
  assert.throws(() => defineProvider({ name: "bad", services: {} as never }), /array/);
  assert.throws(() =>
    createApplication({ providers: [defineProvider({ name: "bad", services: [{} as never] })] }),
  );
});

test("stop during boot retains owned resources until the hook settles and skips transports", async () => {
  let release!: () => void;
  let entered!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const calls: string[] = [];
  const app = createApplication({
    shutdownTimeoutMs: 1,
    providers: [
      defineProvider({
        name: "blocked",
        async boot(scope) {
          await scope.acquire({
            name: "resource",
            open: () => ({ ok: true, value: {} }),
            close() {
              calls.push("close");
            },
          });
          entered();
          await blocked;
        },
      }),
    ],
    transports: [
      {
        name: "transport",
        setup() {
          calls.push("transport");
        },
      },
    ],
  });
  const startup = app.start();
  const failed = assert.rejects(startup);
  await started;
  const stopped = await app.stop();
  assert.equal(stopped.timedOut, true);
  assert.deepEqual(calls, []);
  release();
  await failed;
  assert.equal((await app.completion).successful, true);
  assert.deepEqual(calls, ["close"]);
});
