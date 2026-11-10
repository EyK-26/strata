import { test } from "bun:test";
import assert from "node:assert/strict";
import type { ActiveDatabaseHandle } from "../../src/core/database/connectionContext";
import type {
  Decision,
  DisposeAck,
  RawPin,
  RawTransaction,
  Terminal,
} from "../../src/core/database/driverPorts";
import { legacyNativeTransaction } from "../../src/core/database/legacyNativeTransaction";

const raw: RawTransaction = {
  async execute() {
    throw new Error("unexpected SQL in legacy outcome boundary test");
  },
  async savepoint() {
    throw new Error("unexpected savepoint in legacy outcome boundary test");
  },
};
function terminal<R>(fields: Partial<Terminal<R>>): Terminal<R> {
  return {
    data: "not-started",
    nativeState: "idle",
    stage: { kind: "callback-not-entered" },
    phases: [],
    failure: null,
    ...fields,
  };
}
function scriptedPin(
  begin: RawPin["begin"],
  disposal: {
    release?: () => Promise<DisposeAck>;
    discard?: () => Promise<DisposeAck>;
  } = {},
) {
  const calls: string[] = [];
  const pin: RawPin = {
    async begin<R>(work: (tx: RawTransaction) => Promise<Decision<R>>) {
      calls.push("begin");
      return begin(work);
    },
    async release() {
      calls.push("release");
      return disposal.release ? disposal.release() : { ok: true };
    },
    async discard() {
      calls.push("discard");
      return disposal.discard ? disposal.discard() : { ok: true };
    },
  };
  return { pin, calls };
}
const ownership = () => new WeakSet<ActiveDatabaseHandle>();

const committed: RawPin["begin"] = async <R>(
  work: (tx: RawTransaction) => Promise<Decision<R>>,
) => {
  const decision = await work(raw);
  return terminal<R>({ data: "committed", stage: { kind: "decided", decision } });
};

test("legacy unexpected opaque native failure never admits body and discards once", async () => {
  const error = Object.freeze({ native: "unexpected rejection" });
  let admitted = false;
  const fixture = scriptedPin(async () => {
    throw error;
  });
  await assert.rejects(
    legacyNativeTransaction(
      fixture.pin,
      async () => {
        admitted = true;
        return 1;
      },
      ownership(),
    ),
    (failure: unknown) => failure === error,
  );
  assert.equal(admitted, false);
  assert.deepEqual(fixture.calls, ["begin", "discard"]);
});

test("legacy pre-body native and disposal failures retain exact opaque payloads and order", async () => {
  const fixture = scriptedPin(async <R>() => terminal<R>({ failure: { error: 0 } }), {
    release: async () => ({ ok: false, error: "", ownership: "unknown" }),
  });
  let admitted = false;
  await assert.rejects(
    legacyNativeTransaction(
      fixture.pin,
      async () => {
        admitted = true;
        return 1;
      },
      ownership(),
    ),
    (error: unknown) => {
      assert.ok(error instanceof AggregateError);
      assert.equal(error.message, "Native transaction and disposal failed.");
      assert.deepEqual(error.errors, [0, ""]);
      return true;
    },
  );
  assert.equal(admitted, false);
  assert.deepEqual(fixture.calls, ["begin", "release"]);
});

test("legacy confirmed commit plus throwing release preserves disposal error without rollback or retry", async () => {
  const disposalError = Object.freeze({ cleanup: "release threw after commit" });
  const fixture = scriptedPin(committed, {
    release: async () => {
      throw disposalError;
    },
  });
  let calls = 0;
  await assert.rejects(
    legacyNativeTransaction(
      fixture.pin,
      async () => {
        calls++;
        return 17;
      },
      ownership(),
    ),
    (error: unknown) => error === disposalError,
  );
  assert.equal(calls, 1);
  assert.deepEqual(fixture.calls, ["begin", "release"]);
});

test("legacy falsy body rejection survives rollback and failed rollback composes before disposal", async () => {
  const rollbackError = Object.freeze({ native: "rollback failed" });
  const disposalError = Object.freeze({ native: "discard failed" });
  for (const failedRollback of [false, true]) {
    const fixture = scriptedPin(
      async <R>(work: (tx: RawTransaction) => Promise<Decision<R>>) => {
        try {
          await work(raw);
          assert.fail("body must reject");
        } catch (error) {
          return terminal<R>({
            data: failedRollback ? "unknown" : "rolled-back",
            nativeState: failedRollback ? "unknown" : "idle",
            stage: { kind: "callback-failed", error },
            failure: failedRollback ? { error: rollbackError } : null,
          });
        }
      },
      failedRollback
        ? { discard: async () => ({ ok: false, error: disposalError, ownership: "unknown" }) }
        : {},
    );
    let bodyCalls = 0;
    await assert.rejects(
      legacyNativeTransaction(
        fixture.pin,
        async () => {
          bodyCalls++;
          throw false;
        },
        ownership(),
      ),
      (error: unknown) => {
        if (!failedRollback) assert.equal(error, false);
        else {
          assert.ok(error instanceof AggregateError);
          assert.equal(error.message, "Native transaction and disposal failed.");
          const [primary, disposal] = error.errors;
          assert.ok(primary instanceof AggregateError);
          assert.equal(primary.message, "Native rollback failed; connection discarded.");
          assert.deepEqual(primary.errors, [false, rollbackError]);
          assert.equal(disposal, disposalError);
        }
        return true;
      },
    );
    assert.equal(bodyCalls, 1);
    assert.deepEqual(fixture.calls, ["begin", failedRollback ? "discard" : "release"]);
  }
});

test("legacy decided work cannot manufacture commit from rolled-back or unknown data", async () => {
  for (const data of ["rolled-back", "unknown"] as const) {
    const fixture = scriptedPin(async <R>(work: (tx: RawTransaction) => Promise<Decision<R>>) =>
      terminal<R>({
        data,
        nativeState: data === "unknown" ? "unknown" : "idle",
        stage: { kind: "decided", decision: await work(raw) },
      }),
    );
    let admitted = 0;
    await assert.rejects(
      legacyNativeTransaction(
        fixture.pin,
        async () => {
          admitted++;
          return 23;
        },
        ownership(),
      ),
      { message: "Native transaction did not commit." },
    );
    assert.equal(admitted, 1);
    assert.deepEqual(fixture.calls, ["begin", data === "unknown" ? "discard" : "release"]);
  }
});

test("legacy missing native decision fails closed and safely discards without admitting body", async () => {
  // Deliberately malformed native return tests the defensive boundary, not a legal RawPin implementation.
  const missingTerminal = (async () => undefined) as unknown as RawPin["begin"];
  const fixture = scriptedPin(missingTerminal);
  let admitted = false;
  await assert.rejects(
    legacyNativeTransaction(
      fixture.pin,
      async () => {
        admitted = true;
        return 0;
      },
      ownership(),
    ),
    { message: "Native transaction has no decision." },
  );
  assert.equal(admitted, false);
  assert.deepEqual(fixture.calls, ["begin", "discard"]);
});
