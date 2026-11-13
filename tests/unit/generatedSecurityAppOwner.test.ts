/** Injected orchestration faults against the actual fixture owner, not native DB claims. */
import { expect, spyOn, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CandidatePackageOwnershipError, candidatePackage } from "../../scripts/candidate-packages";
import { GeneratedSecurityAppOwner } from "../helpers/generatedSecurityAppOwner";

const databaseName = `generated_security_${"a".repeat(32)}`;
const mysqlUser = `q01_${"b".repeat(18)}`;
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Expected rejection.");
}

test("injected failure before acquisition preserves every falsy primary and removes only its signal listener", async () => {
  for (const primary of [false, null, undefined]) {
    const before = process.listenerCount("SIGTERM");
    const owner = new GeneratedSecurityAppOwner(databaseName, mysqlUser);
    expect(process.listenerCount("SIGTERM")).toBe(before + 1);
    expect(await rejection(owner.failSetup(primary))).toBe(primary);
    expect(process.listenerCount("SIGTERM")).toBe(before);
  }
});
test("injected setup failure after root acquisition removes its actual directory", async () => {
  const owner = new GeneratedSecurityAppOwner(databaseName, mysqlUser);
  const root = await mkdtemp(join(tmpdir(), "strata-owner-unit-"));
  owner.root = root;
  const primary = new Error("injected after root");
  try {
    expect(await rejection(owner.failSetup(primary))).toBe(primary);
    expect(existsSync(root)).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("actual memoized close joins a late connection after cancellation and refuses the next admission", async () => {
  const owner = new GeneratedSecurityAppOwner(databaseName, mysqlUser);
  const late = deferred<NonNullable<typeof owner.mysql>>();
  const seen: string[] = [];
  owner.connectionAttempted = true;
  const setup = owner.observeSetup(
    (async () => {
      owner.mysql = await late.promise;
      seen.push("acquired");
      owner.admit();
      seen.push("must-not-admit-grant");
    })(),
  );
  owner.cancel();
  const close = owner.close();
  expect(owner.close()).toBe(close);
  let closed = false;
  void close.then(() => {
    closed = true;
  });
  await Promise.resolve();
  expect(closed).toBe(false);
  late.resolve({
    query: async () => [[], []],
    end: async () => {
      seen.push("closed");
    },
  });
  const primary = await rejection(setup);
  expect(primary).toBeInstanceOf(Error);
  await close;
  expect(seen).toEqual(["acquired", "closed"]);
  expect(owner.close()).toBe(close);
  expect(() => owner.admit()).toThrow("interrupted");
  expect(() => owner.handoff()).toThrow("interrupted");
});
test("injected rejected CREATE acknowledgement reconciles exact identifiers, preserving primary and ALL falsy cleanup failures", async () => {
  const owner = new GeneratedSecurityAppOwner(databaseName, mysqlUser);
  const root = await mkdtemp(join(tmpdir(), "strata-owner-unit-"));
  owner.root = root;
  owner.database = "attempted";
  owner.user = "attempted";
  const seen: string[] = [];
  owner.mysql = {
    query: async (sql, values) => {
      seen.push(sql);
      if (sql.startsWith("DROP USER")) throw false;
      if (sql.startsWith("DROP DATABASE")) throw undefined;
      expect(values).toEqual([sql.includes("mysql.user") ? mysqlUser : databaseName]);
      return [[], []];
    },
    end: async () => {
      seen.push("end");
      throw null;
    },
  };
  const primary = new Error("injected lost CREATE acknowledgement");
  try {
    const error = await rejection(owner.failSetup(primary));
    expect(error).toBeInstanceOf(AggregateError);
    if (!(error instanceof AggregateError)) throw new Error("Missing ordered aggregate");
    expect(error.errors).toEqual([primary, false, undefined, null]);
    expect(String(owner.database)).toBe("absent");
    expect(String(owner.user)).toBe("absent");
    expect(seen).toEqual([
      `DROP USER IF EXISTS '${mysqlUser}'@'%'`,
      "SELECT User FROM mysql.user WHERE User = ? AND Host = '%'",
      `DROP DATABASE IF EXISTS ${databaseName}`,
      "SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?",
      "end",
    ]);
    expect(existsSync(root)).toBe(false);
    const close = owner.close();
    expect(owner.close()).toBe(close);
    const cleanup = await rejection(close);
    expect(cleanup).toBeInstanceOf(AggregateError);
    if (cleanup instanceof AggregateError) expect(cleanup.errors).toEqual([false, undefined, null]);
    expect(await rejection(owner.close())).toBe(cleanup);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("injected unresolved native absence remains explicit and both connection closes are attempted", async () => {
  const owner = new GeneratedSecurityAppOwner(databaseName, mysqlUser);
  owner.database = "acquired";
  const drop = new Error("injected drop failure");
  const probe = new Error("injected probe failure");
  const seen: string[] = [];
  owner.postgres = {
    unsafe: async (sql) => {
      if (sql.startsWith("DROP")) throw drop;
      throw probe;
    },
    close: () => {
      seen.push("pg-close");
      throw false;
    },
  };
  owner.mysql = {
    query: async (sql) => {
      if (sql.startsWith("DROP")) throw undefined;
      throw null;
    },
    end: async () => {
      seen.push("mysql-close");
    },
  };
  const error = await rejection(owner.close());
  expect(error).toBeInstanceOf(AggregateError);
  if (error instanceof AggregateError) {
    expect(error.errors.slice(0, 4)).toEqual([drop, probe, undefined, null]);
    expect(error.errors[4]).toBeInstanceOf(Error);
    expect((error.errors[4] as Error).message).toContain("Unresolved generated fixture database");
    expect(error.errors[5]).toBe(false);
  }
  expect(owner.database).toBe("acquired");
  expect(seen).toEqual(["pg-close", "mysql-close"]);
});
test("injected rejected connection without a returned handle is unresolved, and successful handoff removes only its listener", async () => {
  const owner = new GeneratedSecurityAppOwner(databaseName, mysqlUser);
  owner.connectionAttempted = true;
  const primary = undefined;
  const error = await rejection(owner.failSetup(primary));
  expect(error).toBeInstanceOf(AggregateError);
  if (error instanceof AggregateError) {
    expect(error.errors[0]).toBeUndefined();
    expect(error.errors[1].message).toContain("Unresolved generated fixture control connection");
  }
  const before = process.listenerCount("SIGTERM");
  const handed = new GeneratedSecurityAppOwner(databaseName, mysqlUser);
  handed.handoff();
  expect(process.listenerCount("SIGTERM")).toBe(before);
  await handed.close();
});

test("injected default pack observer failures join exit AND streams through cancellation without claiming pack cancellation", async () => {
  const previous = process.env.STRATA_TEST_PACKAGE_DIR;
  delete process.env.STRATA_TEST_PACKAGE_DIR;
  const terminal = deferred<number>();
  let stderr!: ReadableStreamDefaultController<Uint8Array>;
  const output = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.error(false);
    },
  });
  const errorOutput = new ReadableStream<Uint8Array>({
    start(controller) {
      stderr = controller;
    },
  });
  const spawn = spyOn(Bun, "spawn").mockReturnValue({
    exited: terminal.promise,
    stdout: output,
    stderr: errorOutput,
  } as unknown as ReturnType<typeof Bun.spawn>);
  const owner = new GeneratedSecurityAppOwner(databaseName, mysqlUser);
  let setupDone = false,
    closeDone = false,
    admitted = false;
  const setup = owner.observeSetup(
    (async () => {
      await candidatePackage("core", "/unused-injected-pack-destination");
      owner.admit();
      admitted = true;
    })(),
  );
  void setup.then(
    () => {
      setupDone = true;
    },
    () => {
      setupDone = true;
    },
  );
  owner.cancel();
  const close = owner.close();
  void close.then(
    () => {
      closeDone = true;
    },
    () => {
      closeDone = true;
    },
  );
  try {
    await Bun.sleep(0);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(setupDone).toBe(false);
    expect(closeDone).toBe(false);
    terminal.resolve(1);
    await Bun.sleep(0);
    expect(setupDone).toBe(false);
    expect(closeDone).toBe(false);
    stderr.error(null);
    const error = await rejection(setup);
    expect(error).toBeInstanceOf(AggregateError);
    if (error instanceof AggregateError) {
      expect(error.errors.slice(0, 2)).toEqual([false, null]);
      expect(error.errors[2].message).toContain("Candidate core pack failed");
    }
    await close;
    expect(admitted).toBe(false);
  } finally {
    terminal.resolve(1);
    stderr.error(null);
    await Promise.allSettled([setup, close]);
    spawn.mockRestore();
    if (previous === undefined) delete process.env.STRATA_TEST_PACKAGE_DIR;
    else process.env.STRATA_TEST_PACKAGE_DIR = previous;
  }
});

test("injected owner rejected exit retains root/native ownership, joins delayed stream and preserves falsy failures", async () => {
  const root = await mkdtemp(join(tmpdir(), "strata-owner-unit-unknown-"));
  const terminal = deferred<number>();
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  const seen: string[] = [];
  let stops = 0,
    settled = false;
  const spawn = spyOn(Bun, "spawn").mockReturnValue({
    pid: 111111,
    exitCode: null,
    exited: terminal.promise,
    stdout: new ReadableStream({
      start(controller) {
        controller.error(null);
      },
    }),
    stderr: new ReadableStream({
      start(controller) {
        stream = controller;
      },
    }),
    kill: () => {
      stops++;
    },
  } as unknown as ReturnType<typeof Bun.spawn>);
  const owner = new GeneratedSecurityAppOwner(databaseName, mysqlUser);
  owner.root = root;
  owner.database = "acquired";
  owner.user = "attempted";
  owner.postgres = {
    unsafe: async () => {
      seen.push("must-not-drop-pg");
      return [];
    },
    close: () => {
      seen.push("pg-close");
      throw undefined;
    },
  };
  owner.mysql = {
    query: async () => {
      seen.push("must-not-drop-mysql");
      return [[], []];
    },
    end: async () => {
      seen.push("mysql-close");
      throw null;
    },
  };
  const setup = owner.observeSetup(owner.runChild(["injected-not-executed"], root, 1000));
  void setup.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  terminal.reject(false);
  const close = owner.close();
  try {
    await Bun.sleep(0);
    expect(settled).toBe(false);
    expect(seen).toEqual([]);
    expect(existsSync(root)).toBe(true);
    stream.close();
    const primary = await rejection(setup);
    expect(primary).toBeInstanceOf(AggregateError);
    if (primary instanceof AggregateError) {
      const original = primary.errors[0];
      expect(original).toBeInstanceOf(AggregateError);
      if (original instanceof AggregateError) expect(original.errors).toEqual([false, null]);
      expect(primary.message).toContain("111111");
      expect(primary.message).toContain(root);
    }
    const failure = await rejection(close);
    expect(failure).toBeInstanceOf(AggregateError);
    if (failure instanceof AggregateError) {
      expect(failure.errors[0]).toBe(primary);
      expect(failure.errors.slice(-2)).toEqual([undefined, null]);
    }
    expect(owner.close()).toBe(close);
    expect(await rejection(owner.close())).toBe(failure);
    expect(() => owner.admit()).toThrow("unconfirmed");
    expect(() => owner.handoff()).toThrow("unconfirmed");
    expect(seen).toEqual(["pg-close", "mysql-close"]);
    expect(stops).toBe(2);
    expect(existsSync(root)).toBe(true);
    expect(String(owner.database)).toBe("acquired");
    expect(String(owner.user)).toBe("attempted");
  } finally {
    stream.error(null);
    terminal.reject(false);
    await Promise.allSettled([setup, close]);
    spawn.mockRestore();
    // Explicitly synthetic child: test alone may remove the root after asserting retention.
    await rm(root, { recursive: true, force: true });
  }
});

test("injected actual candidate fallback rejected exit conveys exact ownership uncertainty and memoizes retained cleanup", async () => {
  const previous = process.env.STRATA_TEST_PACKAGE_DIR;
  delete process.env.STRATA_TEST_PACKAGE_DIR;
  const root = await mkdtemp(join(tmpdir(), "strata-owner-unit-pack-unknown-"));
  const terminal = deferred<number>();
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  let stops = 0,
    settled = false;
  const seen: string[] = [];
  const spawn = spyOn(Bun, "spawn").mockReturnValue({
    pid: 222222,
    exitCode: null,
    exited: terminal.promise,
    stdout: new ReadableStream({
      start(controller) {
        controller.error(false);
      },
    }),
    stderr: new ReadableStream({
      start(controller) {
        stream = controller;
      },
    }),
    kill: () => {
      stops++;
    },
  } as unknown as ReturnType<typeof Bun.spawn>);
  const owner = new GeneratedSecurityAppOwner(databaseName, mysqlUser);
  owner.root = root;
  owner.database = "acquired";
  owner.postgres = {
    unsafe: async () => {
      seen.push("must-not-drop");
      return [];
    },
    close: () => {
      seen.push("close");
    },
  };
  const setup = owner.observeSetup(
    (async () => {
      await candidatePackage("core", root);
      owner.admit();
      seen.push("must-not-admit");
    })(),
  );
  void setup.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  terminal.reject(null);
  const close = owner.close();
  try {
    await Bun.sleep(0);
    expect(settled).toBe(false);
    expect(seen).toEqual([]);
    expect(existsSync(root)).toBe(true);
    stream.close();
    const primary = await rejection(setup);
    expect(primary).toBeInstanceOf(CandidatePackageOwnershipError);
    if (primary instanceof CandidatePackageOwnershipError) {
      expect(primary.errors).toEqual([false, null]);
      expect(primary.pid).toBe(222222);
      expect(primary.destination).toBe(root);
      expect(primary.disposition).toBe("unresolved");
    }
    const failure = await rejection(close);
    expect(failure).toBeInstanceOf(AggregateError);
    if (failure instanceof AggregateError) expect(failure.errors[0]).toBe(primary);
    expect(owner.close()).toBe(close);
    expect(await rejection(owner.close())).toBe(failure);
    expect(() => owner.admit()).toThrow("unconfirmed");
    expect(seen).toEqual(["close"]);
    expect(stops).toBe(2);
    expect(existsSync(root)).toBe(true);
    expect(String(owner.database)).toBe("acquired");
  } finally {
    stream.error(null);
    terminal.reject(null);
    await Promise.allSettled([setup, close]);
    spawn.mockRestore();
    if (previous === undefined) delete process.env.STRATA_TEST_PACKAGE_DIR;
    else process.env.STRATA_TEST_PACKAGE_DIR = previous;
    // This injected child never existed; remove only the synthetic root after retention assertions.
    await rm(root, { recursive: true, force: true });
  }
});

test("injected fulfilled owner exit plus rejected stream permits exact native/root cleanup after delayed stream joins", async () => {
  const root = await mkdtemp(join(tmpdir(), "strata-owner-unit-confirmed-"));
  const terminal = deferred<number>();
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  let settled = false;
  const spawn = spyOn(Bun, "spawn").mockReturnValue({
    pid: 333333,
    exitCode: 0,
    exited: terminal.promise,
    stdout: new ReadableStream({
      start(controller) {
        controller.error(false);
      },
    }),
    stderr: new ReadableStream({
      start(controller) {
        stream = controller;
      },
    }),
    kill: () => {
      throw new Error("Confirmed child must not need a stop request.");
    },
  } as unknown as ReturnType<typeof Bun.spawn>);
  const owner = new GeneratedSecurityAppOwner(databaseName, mysqlUser);
  owner.root = root;
  owner.database = "acquired";
  const seen: string[] = [];
  owner.mysql = {
    query: async (sql) => {
      seen.push(sql);
      return [[], []];
    },
    end: async () => {
      seen.push("end");
    },
  };
  const setup = owner.observeSetup(owner.runChild(["injected-not-executed"], root, 1000));
  void setup.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  terminal.resolve(0);
  const close = owner.close();
  try {
    await Bun.sleep(0);
    expect(settled).toBe(false);
    expect(existsSync(root)).toBe(true);
    expect(seen).toEqual([]);
    stream.close();
    expect(await rejection(setup)).toBe(false);
    await close;
    expect(owner.close()).toBe(close);
    expect(existsSync(root)).toBe(false);
    expect(String(owner.database)).toBe("absent");
    expect(seen).toEqual([
      `DROP DATABASE IF EXISTS ${databaseName}`,
      "SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?",
      "end",
    ]);
  } finally {
    stream.error(null);
    terminal.resolve(0);
    await Promise.allSettled([setup, close]);
    spawn.mockRestore();
    await rm(root, { recursive: true, force: true });
  }
});
