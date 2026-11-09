import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ChildSupervisorError,
  createBunChildSupervisor,
  type NativeChild,
  type NativeSpawnOptions,
  type ParentSignal,
  type SignalHost,
} from "../../../packages/strata-cli/src/bunChildResource";
import { bounded, deferred, pending, rejected } from "../../fixtures/applicationOwnershipSupport";

class Signals implements SignalHost {
  readonly callbacks = { SIGINT: new Set<() => void>(), SIGTERM: new Set<() => void>() };
  readonly ready = deferred();
  readonly removals: ParentSignal[] = [];
  onHook?: (signal: ParentSignal) => void;
  offHook?: (signal: ParentSignal) => void;
  on(signal: ParentSignal, callback: () => void) {
    this.callbacks[signal].add(callback);
    this.onHook?.(signal);
    if (signal === "SIGTERM") this.ready.resolve();
  }
  off(signal: ParentSignal, callback: () => void) {
    this.removals.push(signal);
    this.callbacks[signal].delete(callback);
    this.offHook?.(signal);
  }
  emit(signal: ParentSignal) {
    for (const callback of [...this.callbacks[signal]]) callback();
  }
  get count() {
    return this.callbacks.SIGINT.size + this.callbacks.SIGTERM.size;
  }
  recover() {
    this.callbacks.SIGINT.clear();
    this.callbacks.SIGTERM.clear();
  }
}

class Child implements NativeChild {
  readonly outcome = deferred<number>();
  readonly exited = this.outcome.promise;
  exitCode: number | null = null;
  readonly kills: ParentSignal[] = [];
  onKill?: (signal: ParentSignal) => void;
  kill(signal: ParentSignal) {
    this.kills.push(signal);
    this.onKill?.(signal);
  }
  exit(code: number) {
    this.exitCode = code;
    this.outcome.resolve(code);
  }
}

async function fileReady(path: string) {
  const end = Date.now() + 3000;
  while (!(await Bun.file(path).exists()) && Date.now() < end) await Bun.sleep(5);
  assert.equal(await Bun.file(path).exists(), true, `Owned child did not become ready: ${path}`);
}

async function ownedPidGone(pid: number, root: string) {
  const end = Date.now() + 1000;
  while (Date.now() < end) {
    try {
      if ((await realpath(`/proc/${pid}/cwd`)) !== root) return;
    } catch (error) {
      if (
        error instanceof Error &&
        ["ENOENT", "ESRCH"].includes(String(Reflect.get(error, "code")))
      )
        return;
      throw error;
    }
    await Bun.sleep(5);
  }
  assert.fail("Acknowledged native child still has its owned PID/cwd");
}

test("private supervisor construction is effect-free and captures cwd, argv, environment and stdio", async () => {
  const signals = new Signals();
  const child = new Child();
  const app = { root: "/owned/original" };
  const args = ["script.ts", "literal argument"];
  const oldMarker = process.env.STRATA_CHILD_CAPTURE_TEST;
  process.env.STRATA_CHILD_CAPTURE_TEST = "original";
  let calls = 0;
  let captured: NativeSpawnOptions | undefined;
  let argv: readonly string[] | undefined;
  const supervisor = createBunChildSupervisor(app, args, {
    signals,
    spawn(command, options) {
      calls++;
      argv = command;
      captured = options;
      return child;
    },
  });
  try {
    assert.equal(calls, 0);
    assert.equal(signals.count, 0);
    assert.equal(supervisor.application.state.phase, "constructed");
    app.root = "/changed";
    args.push("changed");
    process.env.STRATA_CHILD_CAPTURE_TEST = "changed";
    const result = supervisor.run();
    assert.equal(supervisor.run(), result);
    await bounded(signals.ready.promise);
    assert.equal(calls, 1);
    assert.deepEqual(argv?.slice(1), ["script.ts", "literal argument"]);
    assert.equal(captured?.cwd, "/owned/original");
    assert.equal(captured?.env.STRATA_CHILD_CAPTURE_TEST, "original");
    assert.deepEqual(
      [captured?.stdin, captured?.stdout, captured?.stderr],
      ["inherit", "inherit", "inherit"],
    );
    child.exit(3);
    assert.equal(await bounded(result), 3);
    assert.equal(signals.count, 0);
    assert.equal((await supervisor.application.completion).snapshot.cleanup, "clean");
  } finally {
    child.exit(3);
    signals.recover();
    if (oldMarker === undefined) delete process.env.STRATA_CHILD_CAPTURE_TEST;
    else process.env.STRATA_CHILD_CAPTURE_TEST = oldMarker;
  }
});

test("first signal and reentrant repeats share one owned relay until actual child exit", async () => {
  const signals = new Signals();
  const child = new Child();
  let unrelated = 0;
  const sentinel = () => {
    unrelated++;
  };
  signals.callbacks.SIGTERM.add(sentinel);
  child.onKill = () => signals.emit("SIGTERM");
  const supervisor = createBunChildSupervisor({ root: process.cwd() }, [], {
    signals,
    spawn: () => child,
  });
  const result = supervisor.run();
  await bounded(signals.ready.promise);
  signals.emit("SIGINT");
  signals.emit("SIGTERM");
  const stop = supervisor.application.stop({ reason: "later" });
  assert.equal(supervisor.application.stop(), stop);
  await pending(result);
  assert.deepEqual(child.kills, ["SIGINT"]);
  assert.ok(unrelated > 0);
  assert.equal(signals.count, 3);
  child.exit(7);
  assert.equal(await bounded(result), 7);
  assert.equal((await stop).successful, true);
  assert.equal(signals.count, 1);
  assert.ok(signals.callbacks.SIGTERM.has(sentinel));
  signals.recover();
});

test("signal during relay setup waits for its already-owned child despite cancelled startup", async () => {
  const signals = new Signals();
  const child = new Child();
  let spawned = 0;
  child.onKill = () => child.exit(7);
  signals.onHook = (signal) => {
    if (signal === "SIGINT") signals.emit("SIGINT");
  };
  const supervisor = createBunChildSupervisor({ root: process.cwd() }, [], {
    signals,
    spawn() {
      spawned++;
      return child;
    },
  });
  assert.equal(await bounded(supervisor.run()), 7);
  assert.equal(spawned, 1);
  assert.deepEqual(child.kills, ["SIGINT"]);
  assert.equal(supervisor.application.state.boot, "cancelled");
  assert.equal((await supervisor.application.completion).snapshot.cleanup, "clean");
  assert.equal(signals.count, 0);
});

test("stop before run opens no child and no signal callbacks", async () => {
  const signals = new Signals();
  let spawned = 0;
  const supervisor = createBunChildSupervisor({ root: process.cwd() }, [], {
    signals,
    spawn() {
      spawned++;
      return new Child();
    },
  });
  await supervisor.application.stop();
  await rejected(supervisor.run());
  assert.equal(spawned, 0);
  assert.equal(signals.count, 0);
});

test("a child exit racing a signal preserves its real code without killing an exited child", async () => {
  const signals = new Signals();
  const child = new Child();
  const supervisor = createBunChildSupervisor({ root: process.cwd() }, [], {
    signals,
    spawn: () => child,
  });
  const result = supervisor.run();
  await bounded(signals.ready.promise);
  child.exit(4);
  signals.emit("SIGTERM");
  assert.equal(await bounded(result), 4);
  assert.deepEqual(child.kills, []);
  assert.equal(signals.count, 0);
});

test("native terminal status suppresses a racing kill but still waits for exited acknowledgment", async () => {
  const signals = new Signals();
  const child = new Child();
  const supervisor = createBunChildSupervisor({ root: process.cwd() }, [], {
    signals,
    spawn: () => child,
  });
  const result = supervisor.run();
  await bounded(signals.ready.promise);
  child.exitCode = 4;
  signals.emit("SIGTERM");
  await pending(supervisor.application.stop());
  await pending(result);
  assert.deepEqual(child.kills, []);
  assert.equal(signals.count, 2);
  child.outcome.resolve(4);
  assert.equal(await bounded(result), 4);
  assert.equal(signals.count, 0);
});

test("stop timeout neither acknowledges child death nor releases relays, and late exit stays observable", async () => {
  const signals = new Signals();
  const child = new Child();
  const supervisor = createBunChildSupervisor({ root: process.cwd() }, [], {
    signals,
    spawn: () => child,
    shutdownTimeoutMs: 25,
  });
  const result = supervisor.run();
  const failure = rejected(result);
  await bounded(signals.ready.promise);
  signals.emit("SIGINT");
  const stop = await bounded(supervisor.application.stop());
  const oldErrors = [...stop.snapshot.errors];
  assert.equal(stop.timedOut, true);
  assert.equal(stop.snapshot.cleanup, "pending");
  assert.equal(signals.count, 2);
  await pending(result);
  await pending(supervisor.application.completion);
  signals.emit("SIGTERM");
  assert.deepEqual(child.kills, ["SIGINT"]);
  child.exit(0);
  const error = await failure;
  assert.ok(error instanceof ChildSupervisorError);
  assert.equal(error.childExitCode, 0);
  assert.equal(error.stop, stop);
  assert.equal((await error.completion).snapshot.cleanup, "clean");
  assert.deepEqual(stop.snapshot.errors, oldErrors);
  assert.equal(stop.snapshot.cleanup, "pending");
  assert.equal(signals.count, 0);
});

test("opaque kill failures survive confirmed exit and safe listener cleanup", async () => {
  let inspected = 0;
  const hostile = new Error();
  for (const property of ["message", "name", "cause", "code", "toString"]) {
    Object.defineProperty(hostile, property, {
      get() {
        inspected++;
        throw new Error("opaque error inspected");
      },
    });
  }
  for (const marker of [undefined, hostile]) {
    const signals = new Signals();
    const child = new Child();
    child.onKill = () => {
      throw marker;
    };
    const supervisor = createBunChildSupervisor({ root: process.cwd() }, [], {
      signals,
      spawn: () => child,
    });
    const failure = rejected(supervisor.run());
    await bounded(signals.ready.promise);
    signals.emit("SIGINT");
    await pending(supervisor.application.completion);
    assert.equal(signals.count, 2);
    child.exit(7);
    const error = await failure;
    assert.ok(error instanceof ChildSupervisorError);
    assert.equal(error.childExitCode, 7);
    assert.equal(error.primary, undefined);
    assert.deepEqual(error.relayErrors, [marker]);
    assert.equal((await error.completion).snapshot.cleanup, "clean");
    assert.equal(error.stop.successful, true);
    assert.equal(signals.count, 0);
  }
  assert.equal(inspected, 0);
  assert.equal(Object.isFrozen(hostile), false);
});

test("rejected exit observation is unknown disposal rather than invented exit success", async () => {
  const marker = Object.freeze({ exitObserver: "failed" });
  const signals = new Signals();
  const child = new Child();
  const supervisor = createBunChildSupervisor({ root: process.cwd() }, [], {
    signals,
    spawn: () => child,
  });
  const failure = rejected(supervisor.run());
  await bounded(signals.ready.promise);
  child.outcome.reject(marker);
  const error = await failure;
  assert.ok(error instanceof ChildSupervisorError);
  assert.equal(error.childExitCode, null);
  assert.equal(error.primary?.error, marker);
  assert.equal(error.stop.successful, false);
  assert.equal((await error.completion).snapshot.cleanup, "failed");
  assert.ok(supervisor.application.state.retainedResources.length > 0);
  assert.equal(signals.count, 2, "Unknown child death must not silently release ownership");
  // Test-owned recovery of fake callbacks is separate from framework cleanup.
  signals.recover();
});

test("spawn throw preserves a falsy primary and does not certify absence of an unpublished child", async () => {
  const signals = new Signals();
  const supervisor = createBunChildSupervisor({ root: process.cwd() }, [], {
    signals,
    spawn() {
      throw 0;
    },
  });
  const error = await rejected(supervisor.run());
  assert.ok(error instanceof ChildSupervisorError);
  assert.equal(error.primary?.error, 0);
  assert.equal(error.childExitCode, null);
  assert.equal(error.stop.successful, false);
  assert.ok(error.stop.snapshot.retainedResources.length > 0);
  assert.equal(signals.count, 0);
});

test("listener removal failures retain the child code and attempt every owned remover", async () => {
  const marker = Object.freeze({ off: "failed" });
  const signals = new Signals();
  const child = new Child();
  signals.offHook = (signal) => {
    if (signal === "SIGTERM") throw marker;
  };
  const supervisor = createBunChildSupervisor({ root: process.cwd() }, [], {
    signals,
    spawn: () => child,
  });
  const failure = rejected(supervisor.run());
  await bounded(signals.ready.promise);
  child.exit(3);
  const error = await failure;
  assert.ok(error instanceof ChildSupervisorError);
  assert.equal(error.childExitCode, 3);
  assert.equal(error.stop.successful, false);
  assert.ok(error.relayErrors.includes(marker));
  assert.ok(error.stop.snapshot.errors.length > 0);
  assert.deepEqual([...signals.removals].sort(), ["SIGINT", "SIGTERM"]);
  signals.recover();
});

test("partial relay rollback retains a present undefined primary and opaque cleanup failures", async () => {
  const cleanup = Object.freeze({ rollback: "failed" });
  const signals = new Signals();
  const child = new Child();
  child.onKill = () => child.exit(9);
  signals.onHook = (signal) => {
    if (signal === "SIGTERM") throw undefined;
  };
  signals.offHook = (signal) => {
    if (signal === "SIGINT") throw cleanup;
  };
  const supervisor = createBunChildSupervisor({ root: process.cwd() }, [], {
    signals,
    spawn: () => child,
  });
  const error = await rejected(supervisor.run());
  assert.ok(error instanceof ChildSupervisorError);
  assert.notEqual(error.primary, undefined);
  assert.equal(error.primary?.error, undefined);
  assert.equal(error.childExitCode, 9);
  assert.ok(error.relayErrors.includes(cleanup));
  assert.equal(error.stop.successful, false);
  assert.ok(signals.removals.includes("SIGINT"));
  assert.ok(signals.removals.includes("SIGTERM"));
  assert.deepEqual(child.kills, ["SIGTERM"]);
  signals.recover();
});

test("registration failure before or after the first effect preserves primary and safely stops the child", async () => {
  for (const boundary of ["before-first", "after-first"] as const) {
    const marker = boundary === "before-first" ? null : new Error("first registration failed");
    const signals = new Signals();
    const child = new Child();
    child.onKill = () => child.exit(7);
    const supervisor = createBunChildSupervisor({ root: process.cwd() }, [], {
      spawn: () => child,
      signals: {
        on(signal, callback) {
          if (boundary === "before-first") throw marker;
          signals.on(signal, callback);
          throw marker;
        },
        off(signal, callback) {
          signals.off(signal, callback);
        },
      },
    });
    assert.equal(await rejected(supervisor.run()), marker);
    assert.deepEqual(child.kills, ["SIGTERM"]);
    assert.equal(child.exitCode, 7);
    assert.equal(signals.count, 0);
    assert.equal((await supervisor.application.completion).snapshot.cleanup, "clean");
  }
});

test("partial signal registration rolls back attempted callbacks and drains its real owned PID", async () => {
  const directory = await mkdtemp(join(tmpdir(), "strata-child-partial-"));
  const marker = new Error("registration failed after effect");
  const before = { SIGINT: process.listeners("SIGINT"), SIGTERM: process.listeners("SIGTERM") };
  let native: Bun.Subprocess<"inherit", "inherit", "inherit"> | undefined;
  const attempted: Array<{ signal: ParentSignal; callback: () => void }> = [];
  let registrationSawLiveChild = false;
  const supervisor = createBunChildSupervisor(
    { root: directory },
    ["--eval", "setInterval(() => {}, 1000)"],
    {
      spawn(argv, options) {
        native = Bun.spawn([...argv], { ...options });
        return native;
      },
      signals: {
        on(signal, callback) {
          attempted.push({ signal, callback });
          assert.ok(native);
          assert.ok(
            supervisor.application.state.retainedResources.length > 0,
            "Signal setup preceded child journal ownership",
          );
          registrationSawLiveChild = native.exitCode === null;
          process.on(signal, callback);
          if (signal === "SIGTERM") throw marker;
        },
        off(signal, callback) {
          process.off(signal, callback);
        },
      },
    },
  );
  try {
    assert.equal(await rejected(supervisor.run()), marker);
    assert.equal(registrationSawLiveChild, true);
    assert.ok(native && native.pid > 0);
    const acknowledgedExit = await bounded(native.exited, "actual partial-start child exit");
    assert.ok(Number.isInteger(acknowledgedExit));
    assert.ok(
      native.exitCode !== null || native.signalCode !== null,
      "Native terminal status was not reported",
    );
    await ownedPidGone(native.pid, directory);
    assert.deepEqual(process.listeners("SIGINT"), before.SIGINT);
    assert.deepEqual(process.listeners("SIGTERM"), before.SIGTERM);
    assert.equal((await supervisor.application.completion).snapshot.cleanup, "clean");
  } finally {
    if (native?.exitCode === null && native.signalCode === null) native.kill("SIGKILL");
    await native?.exited;
    await bounded(supervisor.application.completion).catch(() => {});
    for (const { signal, callback } of attempted) process.off(signal, callback);
    await rm(directory, { recursive: true, force: true });
  }
});

test("two same-process supervisors retain separate native PIDs and exact signal callback ownership", async () => {
  const directory = await mkdtemp(join(tmpdir(), "strata-child-isolation-"));
  const before = { SIGINT: process.listeners("SIGINT"), SIGTERM: process.listeners("SIGTERM") };
  const children: Bun.Subprocess<"inherit", "inherit", "inherit">[] = [];
  const ownedCallbacks: Array<{ signal: ParentSignal; callback: () => void }> = [];
  const create = (name: string) => {
    const ready = join(directory, `${name}.ready`);
    const source = `process.on("SIGINT",()=>process.exit(7)); process.on("SIGTERM",()=>process.exit(7)); setInterval(()=>{},1000); await Bun.write(${JSON.stringify(ready)},String(process.pid));`;
    return {
      ready,
      supervisor: createBunChildSupervisor({ root: directory }, ["--eval", source], {
        spawn(argv, options) {
          const child = Bun.spawn([...argv], { ...options });
          children.push(child);
          return child;
        },
        signals: {
          on(signal, callback) {
            ownedCallbacks.push({ signal, callback });
            process.on(signal, callback);
          },
          off(signal, callback) {
            process.off(signal, callback);
          },
        },
      }),
    };
  };
  const first = create("A");
  const second = create("B");
  try {
    const a = first.supervisor.run();
    const b = second.supervisor.run();
    await Promise.all([fileReady(first.ready), fileReady(second.ready)]);
    assert.equal(children.length, 2);
    assert.notEqual(children[0]?.pid, children[1]?.pid);
    await bounded(first.supervisor.application.stop({ reason: "SIGINT" }));
    assert.equal(await bounded(a), 7);
    assert.equal(children[1]?.exitCode, null);
    await pending(b);
    assert.equal(process.listeners("SIGINT").length, before.SIGINT.length + 1);
    assert.equal(process.listeners("SIGTERM").length, before.SIGTERM.length + 1);
    await bounded(second.supervisor.application.stop({ reason: "SIGTERM" }));
    assert.equal(await bounded(b), 7);
    assert.deepEqual(process.listeners("SIGINT"), before.SIGINT);
    assert.deepEqual(process.listeners("SIGTERM"), before.SIGTERM);
  } finally {
    for (const child of children)
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await Promise.all(children.map((child) => child.exited));
    await Promise.all([
      first.supervisor.application.completion,
      second.supervisor.application.completion,
    ]);
    for (const { signal, callback } of ownedCallbacks) process.off(signal, callback);
    await rm(directory, { recursive: true, force: true });
  }
});
