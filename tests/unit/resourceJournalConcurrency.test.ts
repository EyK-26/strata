import { test } from "bun:test";
import assert from "node:assert/strict";
import type { CleanupContext, ResourceSpec } from "@getstrata/core/runtime/application";
import { ResourceJournal } from "../../src/core/runtime/resourceJournal";
import {
  bounded,
  deferred,
  pending,
  rejected,
  resource,
} from "../fixtures/applicationOwnershipSupport";

function fixture() {
  const diagnostics: unknown[] = [];
  const journal = new ResourceJournal([], {
    record(diagnostic) {
      diagnostics.push(diagnostic.error);
    },
    changed() {},
  });
  const signal = new AbortController().signal;
  const task: CleanupContext = Object.freeze({ signal, reason: "task-complete" });
  const global: CleanupContext = Object.freeze({
    signal: new AbortController().signal,
    reason: "global-stop",
  });
  return { journal, diagnostics, signal, task, global };
}

test("journal concurrent phases share actual promises and first caller contexts through rejection", async () => {
  const { journal, diagnostics, signal, task, global } = fixture();
  const group = journal.createTaskGroup();
  const entered = deferred();
  const release = deferred();
  const marker = Symbol("shared stop rejection");
  let calls = 0;
  let context!: CleanupContext;
  await journal.acquire(
    group,
    {
      name: "shared",
      open: () => ({ ok: true, value: 1 }),
      async stop(_value, current) {
        calls++;
        context = current;
        entered.resolve();
        await release.promise;
        throw marker;
      },
      close() {
        assert.fail("failed stop cannot close its owned handle");
      },
    },
    signal,
  );
  journal.sealGroup(group);
  const selected = journal.finalizeGroup(group, task);
  await bounded(entered.promise);
  const globalStop = journal.scanStop(global);
  const second = journal.finalizeGroup(group, global);
  await pending(selected);
  await pending(globalStop);
  await pending(second);
  assert.equal(calls, 1, "concurrent journal callers invoke one actual lifecycle hook");
  assert.equal(
    journal.view().unstopped,
    true,
    "pending selected producer stop remains globally unstopped",
  );
  assert.equal(context, task, "actual lifecycle hook captures first caller context by identity");
  release.resolve();
  const result = await bounded(selected);
  assert.equal(
    await bounded(globalStop),
    false,
    "coalesced failed stop remains unsafe for every caller",
  );
  const repeated = await bounded(second);
  assert.equal(repeated, result, "cached selected finalization shares its settled result");
  assert.deepEqual(
    result.cleanupFailures,
    [marker],
    "one actual shared hook contributes one cleanup occurrence",
  );
  assert.equal(result.retained, true);
  assert.deepEqual(diagnostics, [marker]);
  assert.equal(journal.view().unsafe, true);
  assert.equal(
    await journal.scanStop(global),
    false,
    "settled failed phase is never reinterpreted as success",
  );
  assert.equal(calls, 1);
});

test("journal cleanup errors follow invocation order when concurrent rejections settle in reverse", async () => {
  const { journal, diagnostics, signal, task, global } = fixture();
  const group = journal.createTaskGroup();
  const a = deferred();
  const b = deferred();
  const enteredA = deferred();
  const enteredB = deferred();
  const errorA = Symbol("A");
  const errorB = Symbol("B");
  const contexts: CleanupContext[] = [];
  await journal.acquire(
    group,
    {
      name: "A",
      open: () => ({ ok: true, value: "A" }),
      async stop(_value, context) {
        contexts.push(context);
        enteredA.resolve();
        await a.promise;
        throw errorA;
      },
      close() {},
    },
    signal,
  );
  // The global scan's old snapshot contains only A and starts its actual hook.
  const globalStop = journal.scanStop(global);
  await bounded(enteredA.promise);
  await journal.acquire(
    group,
    {
      name: "B",
      open: () => ({ ok: true, value: "B" }),
      async stop(_value, context) {
        contexts.push(context);
        enteredB.resolve();
        await b.promise;
        throw errorB;
      },
      close() {},
    },
    signal,
  );
  journal.sealGroup(group);
  const selected = journal.finalizeGroup(group, task);
  await bounded(enteredB.promise);
  b.resolve();
  await pending(selected);
  assert.deepEqual(
    diagnostics,
    [errorB],
    "later invoked stop may reject before earlier global stop",
  );
  a.resolve();
  const result = await bounded(selected);
  assert.equal(await bounded(globalStop), false);
  assert.deepEqual(contexts, [global, task], "each actual phase keeps its first caller context");
  assert.deepEqual(
    result.cleanupFailures,
    [errorA, errorB],
    "journal cleanup occurrence order follows invocation rather than rejection sequence",
  );
  assert.deepEqual(diagnostics, [errorB, errorA]);
});

test("journal retires clean task history but preserves retained empty ancestor chains", async () => {
  const { journal, signal, task } = fixture();
  const baseline = journal.view();
  for (let index = 0; index < 48; index++) {
    const root = journal.createTaskGroup();
    const child = journal.createTaskGroup(root);
    await journal.acquire(child, resource("same", []), signal);
    journal.sealGroup(child);
    await journal.finalizeGroup(child, task);
    journal.sealGroup(root);
    await journal.finalizeGroup(root, task);
  }
  assert.equal(
    journal.view().resourceCount,
    baseline.resourceCount,
    "successful dynamic resource history returns to static baseline",
  );
  assert.equal(
    journal.view().taskGroupCount,
    baseline.taskGroupCount,
    "successful dynamic task groups return to static baseline",
  );
  assert.equal(
    journal.view().groupCount,
    baseline.groupCount,
    "successful dynamic group definitions are retired",
  );
  const root = journal.createTaskGroup();
  const empty = journal.createTaskGroup(root);
  const retained = journal.createTaskGroup(empty);
  const marker = Symbol("unknown");
  await rejected(
    journal.acquire(
      retained,
      {
        name: "retained",
        open: () => ({ ok: false, error: marker, disposition: "unknown" }),
        close() {},
      },
      signal,
    ),
  );
  for (const group of [retained, empty, root]) {
    journal.sealGroup(group);
    await journal.finalizeGroup(group, task);
  }
  const count = journal.view().taskGroupCount;
  assert.equal(
    count,
    baseline.taskGroupCount + 3,
    "retained task ownership preserves both empty ancestor definitions",
  );
  for (let index = 0; index < 16; index++) {
    const safe = journal.createTaskGroup();
    await journal.acquire(safe, resource("same", []), signal);
    journal.sealGroup(safe);
    await journal.finalizeGroup(safe, task);
  }
  assert.equal(
    journal.view().taskGroupCount,
    count,
    "safe retirement neither accumulates groups nor deletes retained ancestor metadata",
  );
  assert.deepEqual(journal.view().retainedResources, ["retained"]);
});

test("journal prunes known discharged acquisition failures after copying their private ledger", async () => {
  const { journal, diagnostics, signal, task } = fixture();
  const baseline = journal.view();
  const marker = undefined;
  const group = journal.createTaskGroup();
  const spec: ResourceSpec<number> = {
    name: "discharged",
    open: () => ({ ok: false, error: marker, disposition: "not-acquired" }),
    close() {},
  };
  assert.equal(await rejected(journal.acquire(group, spec, signal)), marker);
  journal.sealGroup(group);
  const result = await journal.finalizeGroup(group, task);
  assert.deepEqual(result.acquisitionFailures, [marker]);
  assert.deepEqual(
    diagnostics,
    [],
    "known discharged task errors never accumulate in application observer history",
  );
  assert.deepEqual(result.cleanupFailures, []);
  assert.equal(result.retained, false);
  assert.equal(
    journal.view().resourceCount,
    baseline.resourceCount,
    "discharged task reservation retires after ledger transfer",
  );
  assert.equal(journal.view().taskGroupCount, baseline.taskGroupCount);
});

test("journal shares one resource phase contexts independently across global and selected callers", async () => {
  const { journal, signal, task, global } = fixture();
  const group = journal.createTaskGroup();
  const drainEntered = deferred();
  const drainRelease = deferred();
  const seen: Partial<Record<"stop" | "drain" | "flush" | "close", CleanupContext>> = {};
  const counts = { stop: 0, drain: 0, flush: 0, close: 0 };
  await journal.acquire(
    group,
    {
      name: "one resource",
      open: () => ({ ok: true, value: 1 }),
      stop(_value, context) {
        counts.stop++;
        seen.stop = context;
      },
      async drain(_value, context) {
        counts.drain++;
        seen.drain = context;
        drainEntered.resolve();
        await drainRelease.promise;
      },
      flush(_value, context) {
        counts.flush++;
        seen.flush = context;
      },
      close(_value, context) {
        counts.close++;
        seen.close = context;
      },
    },
    signal,
  );
  await journal.scanStop(global);
  journal.sealGroup(group);
  const selected = journal.finalizeGroup(group, task);
  try {
    await bounded(drainEntered.promise);
    const concurrent = journal.drain(global);
    await pending(concurrent);
    await pending(selected);
    assert.equal(seen.stop, global, "resource stop keeps the first global context");
    assert.equal(
      seen.drain,
      task,
      "same resource drain independently keeps the first selected context",
    );
    assert.equal(counts.close, 0, "shared pending resource drain prevents close");
    drainRelease.resolve();
    assert.equal(await bounded(concurrent), true);
    const result = await bounded(selected);
    assert.equal(result.retained, false);
    assert.deepEqual(result.cleanupFailures, []);
    assert.equal(seen.flush, task);
    assert.equal(seen.close, task);
    assert.deepEqual(
      counts,
      { stop: 1, drain: 1, flush: 1, close: 1 },
      "same resource phases each invoke exactly once with their own first caller",
    );
  } finally {
    drainRelease.resolve();
  }
});

test("journal rejects unregistered sealed and reflection-sealed owners before reservation", async () => {
  const { journal, signal, task } = fixture();
  let opens = 0;
  const group = journal.createTaskGroup();
  const spec: ResourceSpec<number> = {
    name: "guarded",
    open() {
      opens++;
      return { ok: true, value: 1 };
    },
    close() {},
  };
  await rejected(journal.acquire({ ...group, key: Symbol("unregistered") }, spec, signal));
  journal.sealGroup(group);
  await rejected(journal.acquire(group, spec, signal));
  assert.throws(() => journal.createTaskGroup(group), /not admitting children/);
  const reflected = journal.createTaskGroup();
  const proxy = new Proxy(spec, {
    getOwnPropertyDescriptor(target, key) {
      if (key === "open") journal.sealGroup(reflected);
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  await rejected(journal.acquire(reflected, proxy, signal));
  assert.equal(
    opens,
    0,
    "owner sealing during descriptor reflection prevents actual reservation and open",
  );
  assert.equal(journal.view().resourceCount, 0);
  for (const owner of [group, reflected]) {
    const result = await journal.finalizeGroup(owner, task);
    assert.deepEqual(
      result.acquisitionFailures,
      [],
      "failed owner admission creates no private acquisition occurrence",
    );
  }
});

test("execution journal materializes fresh binding sets before effects and finalizes phases across the selection", async () => {
  const { journal, signal, task } = fixture();
  const baseline = journal.view();
  const A = { key: Symbol("A template"), name: "same", requires: [] };
  const B = { key: Symbol("B template"), name: "same", requires: [A.key] };
  const execution = journal.createExecutionResources([A, B]);
  assert.equal(Object.isFrozen(execution), true);
  assert.equal(
    journal.view().groupCount,
    baseline.groupCount + 2,
    "all concrete execution binding owners exist before descriptor or open effects",
  );
  assert.equal(journal.view().resourceCount, baseline.resourceCount);
  const events: string[] = [];
  const stopEntered = deferred();
  const stopRelease = deferred();
  await execution.acquire(A, resource("A", events, { name: "same" }), signal);
  await execution.acquire(
    B,
    resource("B", events, {
      name: "same",
      async stop() {
        events.push("B.stop");
        stopEntered.resolve();
        await stopRelease.promise;
      },
    }),
    signal,
  );
  const root = execution.createRootTaskGroup();
  journal.sealGroup(root);
  await journal.finalizeGroup(root, task);
  const context = Object.freeze({ signal, reason: "execution-complete" });
  const finalization = execution.finalize(context);
  assert.equal(
    execution.finalize(context),
    finalization,
    "execution binding set caches one actual finalization promise",
  );
  assert.throws(() => execution.createRootTaskGroup(), /no longer admitting tasks/);
  let extraOpens = 0;
  await rejected(
    execution.acquire(
      A,
      {
        name: "after seal",
        open() {
          extraOpens++;
          return { ok: true, value: "late" };
        },
        close() {},
      },
      signal,
    ),
  );
  try {
    await bounded(stopEntered.promise);
    await pending(finalization);
    assert.equal(
      events.some((event) => /\.(drain|flush|close)$/.test(event)),
      false,
      "execution selection cannot advance while any stop is actually pending",
    );
  } finally {
    stopRelease.resolve();
  }
  const result = await bounded(finalization);
  assert.equal(
    extraOpens,
    0,
    "execution selection seals admission synchronously before cleanup hooks",
  );
  assert.deepEqual(result.acquisitionFailures, []);
  assert.deepEqual(result.cleanupFailures, []);
  assert.equal(result.retained, false);
  assert.deepEqual(
    events,
    [
      "A.open",
      "B.open",
      "B.stop",
      "A.stop",
      "B.drain",
      "A.drain",
      "B.flush",
      "A.flush",
      "B.close",
      "A.close",
    ],
    "execution set finalization runs whole-selection phases instead of per-binding lifecycles",
  );
  assert.equal(journal.view().groupCount, baseline.groupCount);
  assert.equal(journal.view().resourceCount, baseline.resourceCount);
});

test("execution journal prunes clean binding metadata and discharged initialization diagnostics", async () => {
  const { journal, diagnostics, signal, task } = fixture();
  const baseline = journal.view();
  const template = { key: Symbol("stable template"), name: "same", requires: [] };
  const context = Object.freeze({ signal, reason: "execution-complete" });
  for (let index = 0; index < 32; index++) {
    const execution = journal.createExecutionResources([template]);
    await execution.acquire(template, resource("same", []), signal);
    const root = execution.createRootTaskGroup();
    journal.sealGroup(root);
    await journal.finalizeGroup(root, task);
    await execution.finalize(context);
  }
  assert.equal(
    journal.view().groupCount,
    baseline.groupCount,
    "successful runs retire execution template instantiations to static baseline",
  );
  assert.equal(journal.view().taskGroupCount, baseline.taskGroupCount);
  assert.equal(journal.view().resourceCount, baseline.resourceCount);
  const failed = journal.createExecutionResources([template]);
  assert.equal(
    await rejected(
      failed.acquire(
        template,
        {
          name: "failed",
          open: () => ({ ok: false, error: undefined, disposition: "not-acquired" }),
          close() {},
        },
        signal,
      ),
    ),
    undefined,
  );
  const result = await failed.finalize(context);
  assert.deepEqual(result.acquisitionFailures, [undefined]);
  assert.deepEqual(result.cleanupFailures, []);
  assert.deepEqual(
    diagnostics,
    [],
    "discharged execution initialization errors do not accumulate application history",
  );
  assert.equal(journal.view().groupCount, baseline.groupCount);
  assert.equal(journal.view().resourceCount, baseline.resourceCount);
});
