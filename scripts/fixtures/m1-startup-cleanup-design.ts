// Design-only experiment. This does NOT add a deadline to startGuardedApplication.
import assert from "node:assert/strict";
import { collectProviders, createAppContext } from "@getstrata/bootstrap/context";
import { startGuardedApplication } from "@getstrata/bootstrap/m1";
import { routeRegistry } from "@getstrata/bootstrap/routeRegistry";
import { claimApplicationStartup } from "@getstrata/core/runtime/applicationRegistry";

type Outcome = Readonly<{
  state: "cleaned" | "cleanup-failed" | "metadata-conflict";
  startupReservationReleased: boolean;
  errors: readonly unknown[];
}>;
const completions = new WeakMap<object, Promise<Outcome>>();
function observeOwnedCleanup(
  primary: Error,
  task: () => Promise<void>,
  restore: () => boolean,
  release: () => void,
  timeoutMs: number,
) {
  assert.ok(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 2147483647);
  let complete!: (outcome: Outcome) => void;
  const completion = new Promise<Outcome>((resolve) => {
    complete = resolve;
  });
  let rejectWaiting!: (error: unknown) => void;
  const waiting = new Promise<never>((_resolve, reject) => {
    rejectWaiting = reject;
  });
  const timer = setTimeout(() => {
    const deadline = new Error("Owned startup cleanup deadline exceeded.");
    const failure = new AggregateError([primary, deadline], "M1 startup cleanup timed out.", {
      cause: primary,
    });
    completions.set(failure, completion);
    rejectWaiting(failure);
  }, timeoutMs);
  // Every fulfillment/rejection is consumed even when the deadline wins first.
  void Promise.resolve()
    .then(task)
    .then(
      () => {
        clearTimeout(timer);
        let outcome: Outcome;
        try {
          if (!restore()) {
            const conflict = new Error("Route metadata ownership changed during startup cleanup.");
            outcome = Object.freeze({
              state: "metadata-conflict",
              startupReservationReleased: false,
              errors: Object.freeze([conflict]),
            });
          } else {
            release();
            outcome = Object.freeze({
              state: "cleaned",
              startupReservationReleased: true,
              errors: Object.freeze([]),
            });
          }
        } catch (error) {
          outcome = Object.freeze({
            state: "cleanup-failed",
            startupReservationReleased: false,
            errors: Object.freeze([error]),
          });
        }
        complete(outcome);
        rejectWaiting(
          outcome.state === "cleaned"
            ? primary
            : new AggregateError([primary, ...outcome.errors], "M1 startup cleanup failed.", {
                cause: primary,
              }),
        );
      },
      (error) => {
        clearTimeout(timer);
        complete(
          Object.freeze({
            state: "cleanup-failed",
            startupReservationReleased: false,
            errors: Object.freeze([error]),
          }),
        );
        rejectWaiting(
          new AggregateError([primary, error], "M1 startup cleanup failed.", { cause: primary }),
        );
      },
    );
  return { waiting, completion };
}

const mode = process.argv[2];
assert.ok(
  [
    "timely",
    "late-success",
    "late-drain-rejection",
    "late-metadata-conflict",
    "late-close-rejection",
  ].includes(mode ?? ""),
);
const providers = collectProviders([]).filter((p) =>
  ["core.config", "core.cache", "core.storage", "core.auth", "core.policy"].includes(p.name),
);
let releaseDrain!: () => void, rejectDrain!: (error: Error) => void;
const drain = new Promise<void>((resolve, reject) => {
  releaseDrain = resolve;
  rejectDrain = reject;
});
let closes = 0,
  flushes = 0,
  releases = 0,
  settled = false;
const primary = new Error("owned-startup-primary");
const lateError = new Error("owned-late-cleanup-error");
const unhandled: unknown[] = [];
const onUnhandled = (error: unknown) => {
  unhandled.push(error);
};
process.on("unhandledRejection", onUnhandled);
const resource = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: () => new Response("provider-live"),
});
const releaseReservation = claimApplicationStartup();
const context = await createAppContext([
  ...providers,
  {
    name: "owned",
    register({ onCleanup }) {
      onCleanup(() => (mode === "timely" ? undefined : drain), "drain");
      onCleanup(() => {
        flushes++;
      }, "flush");
      onCleanup(async () => {
        closes++;
        await resource.stop(true);
        if (mode === "late-close-rejection") throw lateError;
      });
    },
  },
]);
routeRegistry.register({ method: "GET", path: "/before", middleware: [] });
const publication = routeRegistry.installSnapshot([
  { method: "GET", path: "/candidate", middleware: [] },
]);
const { waiting, completion } = observeOwnedCleanup(
  primary,
  () => context.dispose(),
  () => publication.restore(),
  () => {
    releases++;
    releaseReservation();
  },
  20,
);
void completion.then(() => {
  settled = true;
});
let failure: unknown;
try {
  try {
    await waiting;
  } catch (error) {
    failure = error;
  }
  if (mode === "timely") {
    assert.equal(failure, primary);
    assert.equal((await completion).state, "cleaned");
  } else {
    assert.ok(failure instanceof AggregateError);
    assert.equal(failure.cause, primary);
    assert.equal(failure.errors[0], primary);
    assert.equal(completions.get(failure), completion);
    assert.equal(settled, false);
    assert.equal(closes, 0);
    assert.equal(flushes, 0);
    assert.equal(releases, 0);
    assert.equal(await (await fetch(resource.url)).text(), "provider-live");
    await assert.rejects(startGuardedApplication({ providers, modules: [] }), /already active/);
    if (mode === "late-metadata-conflict")
      routeRegistry.register({ method: "GET", path: "/foreign", middleware: [] });
    if (mode === "late-drain-rejection") rejectDrain(lateError);
    else releaseDrain();
  }
  const outcome = await completion;
  if (mode === "timely" || mode === "late-success") {
    assert.equal(outcome.state, "cleaned");
    assert.equal(outcome.startupReservationReleased, true);
    assert.equal(releases, 1);
    assert.equal(closes, 1);
    assert.equal(flushes, 1);
    assert.deepEqual(
      routeRegistry.list().map((row) => row.path),
      ["/before"],
    );
    const retry = await startGuardedApplication({ providers, modules: [] });
    assert.equal((await retry.shutdown()).successful, true);
  } else {
    assert.equal(outcome.startupReservationReleased, false);
    assert.equal(releases, 0);
    if (mode === "late-metadata-conflict") {
      assert.equal(outcome.state, "metadata-conflict");
      assert.ok(routeRegistry.list().some((row) => row.path === "/foreign"));
      assert.ok(!routeRegistry.list().some((row) => row.path === "/before"));
    } else {
      assert.equal(outcome.state, "cleanup-failed");
      assert.ok(outcome.errors[0] instanceof AggregateError);
      assert.ok((outcome.errors[0] as AggregateError).errors.includes(lateError));
    }
    assert.equal(closes, mode === "late-drain-rejection" ? 0 : 1);
    await assert.rejects(startGuardedApplication({ providers, modules: [] }), /already active/);
  }
  if (mode !== "timely") assert.equal((failure as AggregateError).cause, primary);
  await Bun.sleep(1);
  assert.deepEqual(unhandled, []);
  console.log(
    JSON.stringify({
      designOnly: true,
      mode,
      observedDeadline: mode !== "timely",
      state: outcome.state,
      startupReservationReleased: outcome.startupReservationReleased,
      closes,
      flushes,
      releases,
      primaryCausePreserved: true,
      noUnhandledRejection: true,
    }),
  );
} finally {
  process.off("unhandledRejection", onUnhandled);
  await resource.stop(true);
}
