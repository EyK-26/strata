import { expect, spyOn, test } from "bun:test";
import assert from "node:assert/strict";
import type { Server } from "bun";
import { webServerResource } from "../../src/bootstrap/web/server";
import { createApplication } from "../../src/core/runtime/application";

function owner(port: number, native: { hostname: string } = { hostname: "127.0.0.1" }) {
  return createApplication({
    providers: [],
    transports: [
      {
        name: "test.http",
        async setup(scope) {
          await scope.acquire(
            webServerResource({ port, native, routes: { "/": () => new Response("owned") } }),
          );
        },
      },
    ],
  });
}
async function unusedPort() {
  const reservation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
  const port = reservation.port;
  assert.ok(port);
  await reservation.stop(true);
  return port;
}
function registrationFault(error: unknown) {
  const original = Map.prototype.set;
  return spyOn(Map.prototype, "set").mockImplementation(function (
    this: Map<unknown, unknown>,
    key: unknown,
    value: unknown,
  ) {
    if (key === "stop" && Array.isArray(value) && typeof value[0] === "function") throw error;
    return original.call(this, key, value);
  });
}
function thrown(work: () => Promise<unknown>): Promise<unknown> {
  return work().then(
    () => {
      throw new Error("Expected startup rejection");
    },
    (error) => error,
  );
}

test("occupied native listen preserves original rejection and discharges only the failed acquisition", async () => {
  const incumbent = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response("incumbent"),
  });
  assert.ok(incumbent.port);
  const app = owner(incumbent.port);
  try {
    const error = await thrown(() => app.start());
    expect(Object.getOwnPropertyDescriptor(error, "code")?.value).toBe("EADDRINUSE");
    expect(Object.getOwnPropertyDescriptor(error, "syscall")?.value).toBe("listen");
    const result = await app.stop();
    expect(result.successful).toBe(true);
    expect(result.snapshot.retainedResources).toEqual([]);
    expect(result.snapshot.errors.find((row) => row.code === "ACQUISITION_FAILED")?.error).toBe(
      error,
    );
    expect(await (await fetch(incumbent.url)).text()).toBe("incumbent");
  } finally {
    await app.stop();
    await incumbent.stop(true);
  }
});

test("healthy owned HTTP acquisition closes its actual listener", async () => {
  const port = await unusedPort();
  const app = owner(port);
  try {
    await app.start();
    expect(await (await fetch(`http://127.0.0.1:${port}`)).text()).toBe("owned");
    expect((await app.stop()).successful).toBe(true);
    await expect(
      fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(2000) }),
    ).rejects.toThrow();
    const replacement = Bun.serve({
      hostname: "127.0.0.1",
      port,
      fetch: () => new Response("replacement"),
    });
    await replacement.stop(true);
  } finally {
    await app.stop();
  }
});

test("pre-acquisition configuration getter with spoofed native data stays unknown", async () => {
  const error = Object.assign(new Error("configuration failed"), {
    code: "EADDRINUSE",
    syscall: "listen",
  });
  const app = owner(0, {
    get hostname(): string {
      throw error;
    },
  });
  expect(await thrown(() => app.start())).toBe(error);
  const result = await app.stop();
  expect(result.successful).toBe(false);
  expect(result.snapshot.retainedResources).toContain("http.server");
  expect(
    result.snapshot.errors.find((row) => row.code === "ACQUISITION_OUTCOME_UNKNOWN")?.error,
  ).toBe(error);
});

test("ambiguous native failures stay unknown without reading error accessors", async () => {
  let reads = 0;
  const accessors = Object.defineProperties(new Error("native accessor error"), {
    code: {
      get() {
        reads++;
        return "EADDRINUSE";
      },
    },
    syscall: {
      get() {
        reads++;
        return "listen";
      },
    },
  });
  const wrongSyscall = Object.assign(new Error("ambiguous native error"), {
    code: "EADDRINUSE",
    syscall: "connect",
  });
  for (const error of [accessors, wrongSyscall]) {
    const native = spyOn(Bun, "serve").mockImplementation(() => {
      throw error;
    });
    const app = owner(0);
    try {
      expect(await thrown(() => app.start())).toBe(error);
      const result = await app.stop();
      expect(result.successful).toBe(false);
      expect(result.snapshot.retainedResources).toContain("http.server");
      expect(
        result.snapshot.errors.find((row) => row.code === "ACQUISITION_OUTCOME_UNKNOWN")?.error,
      ).toBe(error);
    } finally {
      native.mockRestore();
    }
  }
  expect(reads).toBe(0);
});

test("actual nested websocket and TLS getters cannot spoof a proven native bind failure", async () => {
  for (const kind of ["websocket.message", "tls.key", "tls.cert"] as const) {
    const error = Object.assign(new Error(`nested ${kind}`), {
      code: "EADDRINUSE",
      syscall: "listen",
    });
    let reads = 0;
    const native: Record<string, unknown> = { hostname: "127.0.0.1" };
    const nested: Record<string, unknown> = {};
    const [field, property] = kind.split(".");
    assert.ok(field && property);
    Object.defineProperty(nested, property, {
      enumerable: true,
      get() {
        reads++;
        throw error;
      },
    });
    native[field] = nested;
    const app = owner(0, native as { hostname: string });
    expect(await thrown(() => app.start())).toBe(error);
    expect(reads).toBe(1);
    const result = await app.stop();
    expect(result.successful).toBe(false);
    expect(result.snapshot.retainedResources).toContain("http.server");
    expect(
      result.snapshot.errors.find((row) => row.code === "ACQUISITION_OUTCOME_UNKNOWN")?.error,
    ).toBe(error);
  }
});

test("nonprimitive native options conservatively retain a genuine listen conflict", async () => {
  const incumbent = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response("incumbent"),
  });
  assert.ok(incumbent.port);
  const resource = webServerResource({
    port: incumbent.port,
    native: { hostname: "127.0.0.1", websocket: { message() {} } },
  });
  try {
    const error = await thrown(async () => resource.open(new AbortController().signal));
    expect(Object.getOwnPropertyDescriptor(error, "code")?.value).toBe("EADDRINUSE");
    expect(await (await fetch(incumbent.url)).text()).toBe("incumbent");
  } finally {
    await incumbent.stop(true);
  }
});

test("actual port coercion cannot spoof a proven native listen conflict", async () => {
  const error = Object.assign(new Error("port coercion failed"), {
    code: "EADDRINUSE",
    syscall: "listen",
  });
  let reads = 0;
  const port = {
    valueOf() {
      reads++;
      throw error;
    },
  };
  const app = owner(port as unknown as number);
  expect(await thrown(() => app.start())).toBe(error);
  expect(reads).toBe(1);
  const result = await app.stop();
  expect(result.successful).toBe(false);
  expect(result.snapshot.retainedResources).toContain("http.server");
  expect(
    result.snapshot.errors.find((row) => row.code === "ACQUISITION_OUTCOME_UNKNOWN")?.error,
  ).toBe(error);
});

test("post-acquisition registration failure waits for exact native close before cleaned outcome", async () => {
  const port = await unusedPort();
  const registrationError = new Error("registration failed");
  const resource = webServerResource({ port, native: { hostname: "127.0.0.1" } });
  const reference = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
  const prototype = Object.getPrototypeOf(reference);
  const original = reference.stop;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let closed: Server<unknown> | undefined;
  const close = spyOn(prototype, "stop").mockImplementation(async function (
    this: Server<unknown>,
    force?: boolean,
  ) {
    if (this.port === port) {
      closed = this;
      await gate;
    }
    await original.call(this, force);
  });
  const fault = registrationFault(registrationError);
  let settled = false;
  const pending = Promise.resolve(resource.open(new AbortController().signal)).then((value) => {
    settled = true;
    return value;
  });
  try {
    await Promise.resolve();
    expect(closed?.port).toBe(port);
    expect(settled).toBe(false);
    release();
    const outcome = await pending;
    expect(outcome).toEqual({ ok: false, error: registrationError, disposition: "cleaned" });
    fault.mockRestore();
    close.mockRestore();
    const replacement = Bun.serve({ hostname: "127.0.0.1", port, fetch: () => new Response() });
    await replacement.stop(true);
  } finally {
    release();
    await pending;
    fault.mockRestore();
    close.mockRestore();
    await closed?.stop(true);
    await reference.stop(true);
  }
});

test("post-acquisition close failure keeps original and cleanup errors with unknown ownership", async () => {
  const port = await unusedPort();
  const registrationError = new Error("registration failed");
  const cleanupError = new Error("native close failed");
  const reference = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
  const prototype = Object.getPrototypeOf(reference);
  const original = reference.stop;
  let acquired: Server<unknown> | undefined;
  const close = spyOn(prototype, "stop").mockImplementation(function (
    this: Server<unknown>,
    force?: boolean,
  ) {
    if (this.port === port) {
      acquired = this;
      return Promise.reject(cleanupError);
    }
    return original.call(this, force);
  });
  const fault = registrationFault(registrationError);
  const app = owner(port);
  try {
    const error = await thrown(() => app.start());
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toContain(registrationError);
    expect((error as AggregateError).errors).toContain(cleanupError);
    const result = await app.stop();
    expect(result.successful).toBe(false);
    expect(result.snapshot.retainedResources).toContain("http.server");
    expect(result.snapshot.errors.find((row) => row.code === "ACQUISITION_FAILED")?.error).toBe(
      registrationError,
    );
    expect(result.snapshot.errors.find((row) => row.kind === "cleanup")?.error).toBe(cleanupError);
  } finally {
    fault.mockRestore();
    close.mockRestore();
    await acquired?.stop(true);
    await reference.stop(true);
  }
});
