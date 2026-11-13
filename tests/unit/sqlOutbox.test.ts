import { describe, expect, test } from "bun:test";
import { createPersistenceInvocation } from "@getstrata/bootstrap/persistenceInvocation";
import type { ApplicationConfig } from "@getstrata/core/contracts/application";
import type { PersistenceInvocation } from "@getstrata/core/contracts/persistence";
import { PersistenceError } from "@getstrata/core/database/errors";
import { createOwnedReadOnlyObservation } from "@getstrata/core/database/ownedReadOnlyObservation";
import type { TransactionSession } from "@getstrata/core/database/session";
import {
  createOutboxMetricsCollector,
  createOutboxMigration,
  createSqlOutboxBindings,
  type DurableListener,
  SqlOutbox,
} from "@getstrata/core/events/outbox";
import { bounded, deferred, pending } from "../fixtures/applicationOwnershipSupport";
import {
  createNativePersistenceApplication,
  sessionSql,
} from "../helpers/nativePersistenceApplication";
import { withOutboxes } from "../helpers/outboxApplication";

const tenant = { id: 42, slug: "outbox", plan: "free" as const, region: "eu" as const };
const listener = (handle: DurableListener["handle"], name = "receipt"): DurableListener => ({
  name,
  event: "orders.created",
  handle,
});
async function expectNativeFailure(promise: Promise<unknown>, message: string) {
  const failure: unknown = await promise.catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(PersistenceError);
  let native = failure;
  while (native instanceof PersistenceError) native = native.cause;
  expect(native).toBeInstanceOf(Error);
  expect((native as Error).message).toContain(message);
}
function occurrences(error: unknown): unknown[] {
  return error instanceof AggregateError ? error.errors.flatMap(occurrences) : [error];
}
async function expectCancellation(promise: Promise<unknown>, signal: AbortSignal) {
  const rejected = await promise.then(
    () => {
      throw new Error("Expected cancellation rejection");
    },
    (error) => error,
  );
  const failures = occurrences(rejected);
  expect(failures.length).toBeGreaterThan(0);
  expect(failures.every((error) => error === signal.reason)).toBe(true);
}
describe("durable SQL outbox on SQLite", () => {
  test("metrics reject private in-memory SQLite rather than returning a healthy zero", async () =>
    withOutboxes(
      [],
      async (fixture) => {
        const observeReadOnly = createOwnedReadOnlyObservation(fixture.application, "main", {
          driver: "sqlite",
          filename: ":memory:",
        });
        const collector = createOutboxMetricsCollector({ observeReadOnly });
        await expect(collector.collect()).rejects.toThrow("file-backed SQLite");
        await collector.close();
        for (const timeoutMs of [0, 5001, NaN])
          expect(() => createOutboxMetricsCollector({ observeReadOnly, timeoutMs })).toThrow();
        for (const sampleLimit of [0, 1001, 1.5])
          expect(() => createOutboxMetricsCollector({ observeReadOnly, sampleLimit })).toThrow();
      },
      { connection: { driver: "sqlite", filename: ":memory:" } },
    ));
  test("read-only delivery inspection distinguishes missing, pending, processing and completed", async () => {
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const admission = new Promise<void>((resolve) => {
      entered = resolve;
    });

    await withOutboxes(
      [
        {
          listeners: [
            listener(async () => {
              entered();
              await gate;
            }),
          ],
        },
        { listeners: [] },
      ],
      async (fixture) => {
        const [outbox, retired] = fixture.outboxes;
        if (!outbox || !retired) throw Error("Missing fixture coordinator");
        const { db, publish } = fixture;

        expect(await fixture.inspect(outbox, "missing", "receipt")).toBeNull();
        await publish(outbox);
        const before = await db.unsafe("SELECT * FROM strata_outbox_delivery");
        expect(await fixture.inspect(outbox, "order:1", "receipt")).toEqual({
          status: "pending",
          attempts: 0,
          maxAttempts: 5,
        });
        expect(await fixture.inspect(outbox, "order:1", "unknown")).toBeNull();
        expect(await db.unsafe("SELECT * FROM strata_outbox_delivery")).toEqual(before);
        const processing = outbox.processNext();
        try {
          await admission;
          expect(await fixture.inspect(outbox, "order:1", "receipt")).toEqual({
            status: "processing",
            attempts: 1,
            maxAttempts: 5,
          });
        } finally {
          release();
          await processing;
        }

        expect(await fixture.inspect(retired, "order:1", "receipt")).toEqual({
          status: "completed",
          attempts: 1,
          maxAttempts: 5,
        });
      },
    );
  });
  test("inspection observes terminal failure and replay without implementing replay itself", async () => {
    await withOutboxes(
      [
        {
          maxAttempts: 1,
          listeners: [
            listener(async () => {
              throw new Error("provider-secret");
            }),
          ],
        },
      ],
      async (fixture) => {
        const [outbox] = fixture.outboxes;
        if (!outbox) throw Error("Missing fixture coordinator");
        const { publish } = fixture;

        await publish(outbox);
        await outbox.processNext();
        expect(await fixture.inspect(outbox, "order:1", "receipt")).toEqual({
          status: "failed",
          attempts: 1,
          maxAttempts: 1,
        });
        await outbox.replay("order:1", "receipt");
        expect(await fixture.inspect(outbox, "order:1", "receipt")).toEqual({
          status: "pending",
          attempts: 0,
          maxAttempts: 1,
        });
        for (const [event, name] of [
          ["bad'", "receipt"],
          ["order:1", "bad'"],
          ["", "receipt"],
          ["x".repeat(65), "receipt"],
          ["order:1", "x".repeat(129)],
        ] as const)
          await expect(fixture.inspect(outbox, event, name)).rejects.toThrow("Invalid durable");
      },
    );
  });
  test("inspection rejects corrupt status and unsafe persisted counters", async () => {
    await withOutboxes([{ listeners: [listener(async () => {})] }], async (fixture) => {
      const [outbox] = fixture.outboxes;
      if (!outbox) throw Error("Missing fixture coordinator");
      const { db, publish } = fixture;

      await publish(outbox);
      await db.unsafe("PRAGMA ignore_check_constraints = ON");
      for (const [status, attempts, max] of [
        ["invalid", 0, 5],
        ["pending", -1, 5],
        ["pending", 0, 0],
        ["pending", 9007199254740992, 5],
        ["pending", 0, 9007199254740992],
      ]) {
        await db.unsafe("UPDATE strata_outbox_delivery SET status=?,attempts=?,max_attempts=?", [
          status,
          attempts,
          max,
        ]);
        await expect(fixture.inspect(outbox, "order:1", "receipt")).rejects.toThrow(
          "Invalid outbox delivery snapshot",
        );
      }
    });
  });

  test("publication commits no side effects; restart delivers the persisted listener snapshot", async () => {
    const received: unknown[] = [];

    await withOutboxes(
      [
        {
          listeners: [
            listener(async (event) => {
              received.push(event);
            }),
          ],
        },
        {
          listeners: [
            listener(async (event) => {
              received.push(event);
            }),
          ],
        },
      ],
      async (fixture) => {
        const [original, restarted] = fixture.outboxes;
        if (!original || !restarted) throw Error("Missing fixture coordinator");
        const { publish, delivery } = fixture;

        await publish(original);
        expect(received).toEqual([]);

        expect(await restarted.processNext()).toBe(true);
        expect(received).toEqual([
          {
            id: "order:1",
            name: "orders.created",
            version: 1,
            tenantId: null,
            payload: { amount: 100 },
          },
        ]);
        expect((await delivery())[0]?.status).toBe("completed");
        expect(await restarted.processNext()).toBe(false);
        await fixture.migration("down");
      },
    );
  });
  test("rollback and savepoint discard events together with business writes", async () => {
    await withOutboxes([{ listeners: [listener(async () => {})] }], async (fixture) => {
      const [outbox] = fixture.outboxes;
      if (!outbox) throw Error("Missing fixture coordinator");
      const { delivery } = fixture;

      await expect(
        fixture.transaction(async (selected) => {
          await outbox.publish(selected, "orders.created", 1, { tenantId: null });
          throw new Error("rollback");
        }),
      ).rejects.toThrow("rollback");
      expect(await delivery()).toEqual([]);
      await fixture.transaction(async (selected) => {
        await expect(
          selected.transaction(async (selected) => {
            await outbox.publish(selected, "orders.created", 2, { tenantId: null });
            throw new Error("nested");
          }),
        ).rejects.toThrow("nested");
        await outbox.publish(selected, "orders.created", 3, { tenantId: null });
        await expect(outbox.processNext()).rejects.toThrow("outside business transactions");
        await expect(outbox.replay("order:1", "receipt")).rejects.toThrow(
          "outside business transactions",
        );
      });
      expect((await delivery()).length).toBe(1);
      await expect(fixture.migration("down")).rejects.toThrow("undelivered");
      await fixture.migration("up");
    });
  });
  test("owner guards reject foreign and expired selections while lineage distinguishes apps, pools and terminal contexts", async () => {
    await withOutboxes(
      [{ listeners: [listener(async () => {})] }],
      async (first) => {
        const [outbox] = first.outboxes;
        if (!outbox) throw Error("Missing first coordinator");
        await withOutboxes([{ listeners: [listener(async () => {})] }], async (second) => {
          const [foreign] = second.outboxes;
          if (!foreign) throw Error("Missing second coordinator");
          const other = createPersistenceInvocation(first.application, "other");
          await second.transaction(async (selected) => {
            expect(() =>
              outbox.publish(selected, "orders.created", {}, { tenantId: null }),
            ).toThrow("scope");
            await expect(outbox.getDelivery(selected, "order:1", "receipt")).rejects.toThrow(
              "scope",
            );
          });
          await first.transaction(async () => {
            expect(await foreign.processNext()).toBe(false);
          });
          await other({ kind: "command" }, ({ database }) =>
            database.transaction(async (selected) => {
              expect(() =>
                outbox.publish(selected, "orders.created", {}, { tenantId: null }),
              ).toThrow("scope");
              await expect(outbox.getDelivery(selected, "order:1", "receipt")).rejects.toThrow(
                "scope",
              );
              expect(await outbox.processNext()).toBe(false);
            }),
          );
          const gate = deferred();
          let stale!: Promise<boolean>;
          let expired!: TransactionSession;
          await first.transaction(async (selected) => {
            expired = selected;
            stale = gate.promise.then(() => outbox.processNext());
            await expect(outbox.processNext()).rejects.toThrow("outside business transactions");
            await expect(outbox.work({ signal: new AbortController().signal })).rejects.toThrow(
              "outside business transactions",
            );
          });
          gate.resolve();
          expect(await bounded(stale)).toBe(false);
          expect(() => outbox.publish(expired, "orders.created", {}, { tenantId: null })).toThrow();
          await expect(outbox.getDelivery(expired, "order:1", "receipt")).rejects.toThrow();
          expect(await first.delivery()).toEqual([]);
          expect(await second.delivery()).toEqual([]);
        });
      },
      { additionalConnections: { other: { driver: "sqlite", filename: ":memory:" } } },
    );
  });

  for (const renewalFails of [false, true])
    test(`caller cancellation joins handler and renewal, retaining renewal failure=${renewalFails}`, async () => {
      const controller = new AbortController();
      const entered = deferred();
      const releaseHandler = deferred();
      const renewing = deferred();
      const releaseRenewal = deferred();
      const renewalError = new Error("renewal failed during cancellation");
      let effects = 0;
      await withOutboxes(
        [
          {
            leaseMs: 300,
            maxAttempts: 1,
            listeners: [
              listener(async (_event, { signal }) => {
                entered.resolve();
                await releaseHandler.promise;
                signal.throwIfAborted();
                effects++;
              }),
            ],
          },
        ],
        async (fixture) => {
          const [outbox] = fixture.outboxes;
          if (!outbox) throw Error("Missing fixture coordinator");
          fixture.faults.beforeInvoke = async (envelope) => {
            if (envelope.actor?.kind === "system" && envelope.actor.policy === "outbox.renew") {
              renewing.resolve();
              await releaseRenewal.promise;
              if (renewalFails) throw renewalError;
            }
          };
          await fixture.publish(outbox);
          const processing = outbox.processNext({ signal: controller.signal });
          const rejected = renewalFails
            ? processing.then(
                () => {
                  throw new Error("Expected cancellation and renewal rejection");
                },
                (error) => {
                  const failures = occurrences(error);
                  expect(failures).toContain(controller.signal.reason);
                  expect(failures).toContain(renewalError);
                },
              )
            : expectCancellation(processing, controller.signal);
          try {
            await bounded(entered.promise);
            await bounded(renewing.promise);
            controller.abort(new Error("caller stopped delivery"));
            await pending(processing);
            releaseHandler.resolve();
            await pending(processing);
            expect((await fixture.delivery())[0]?.status).toBe("processing");
            releaseRenewal.resolve();
            await bounded(rejected);
            expect(effects).toBe(0);
            expect((await fixture.delivery())[0]?.status).toBe("failed");
          } finally {
            controller.abort();
            releaseHandler.resolve();
            releaseRenewal.resolve();
            await rejected;
          }
        },
      );
    });

  test("duplicates preserve the original snapshot and conflicting reuse fails", async () => {
    await withOutboxes(
      [
        { listeners: [listener(async () => {})] },
        {
          listeners: [listener(async () => {}), listener(async () => {}, "another")],
        },
      ],
      async (fixture) => {
        const [outbox, changed] = fixture.outboxes;
        if (!outbox || !changed) throw Error("Missing fixture coordinator");
        const { publish, delivery } = fixture;

        await publish(outbox);

        await publish(changed);
        expect((await delivery()).length).toBe(1);
        await expect(publish(outbox, "order:1", { amount: 200 })).rejects.toThrow("Conflicting");
        await expect(
          fixture.transaction((selected) =>
            outbox.publish(
              selected,
              "orders.created",
              { amount: 100 },
              { id: "order:1", version: 2, tenantId: null },
            ),
          ),
        ).rejects.toThrow("Conflicting");
      },
    );
  });
  test("failed listeners retain bounded errors and replay does not repeat completed listeners", async () => {
    let failing = true;
    const calls: string[] = [];

    await withOutboxes(
      [
        {
          maxAttempts: 1,
          listeners: [
            listener(async () => {
              calls.push("receipt");
            }),
            listener(async () => {
              if (failing) throw new Error("provider-secret");
              calls.push("second");
            }, "second"),
          ],
        },
      ],
      async (fixture) => {
        const [outbox] = fixture.outboxes;
        if (!outbox) throw Error("Missing fixture coordinator");
        const { publish, delivery } = fixture;

        await publish(outbox);
        await outbox.processNext();
        await outbox.processNext();
        expect((await delivery()).map((row) => [row.status, row.error_code])).toEqual([
          ["completed", null],
          ["failed", "listener_failed"],
        ]);
        failing = false;
        await outbox.replay("order:1", "receipt");
        await outbox.replay("order:1", "second");
        await outbox.processNext();
        expect(calls).toEqual(["receipt", "second"]);
      },
    );
  });
  test("retry schedule persists across worker reconstruction", async () => {
    await withOutboxes(
      [
        {
          retryDelayMs: 35,
          listeners: [
            listener(async () => {
              throw new Error("retry");
            }),
          ],
        },
        { listeners: [listener(async () => {})] },
      ],
      async (fixture) => {
        const [outbox, restarted] = fixture.outboxes;
        if (!outbox || !restarted) throw Error("Missing fixture coordinator");
        const { publish, delivery } = fixture;

        await publish(outbox);
        await outbox.processNext();
        expect((await delivery())[0]?.status).toBe("pending");

        expect(await restarted.processNext()).toBe(false);
        await Bun.sleep(45);
        expect(await restarted.processNext()).toBe(true);
        expect((await delivery())[0]?.attempts).toBe(2);
      },
    );
  });
  test("abandoned final attempt becomes recoverable failure rather than vanishing", async () => {
    await withOutboxes(
      [{ maxAttempts: 1, listeners: [listener(async () => {})] }],
      async (fixture) => {
        const [outbox] = fixture.outboxes;
        if (!outbox) throw Error("Missing fixture coordinator");
        const { db, publish, delivery } = fixture;

        await publish(outbox);
        await db.unsafe(
          "UPDATE strata_outbox_delivery SET status='processing', attempts=1, lease_until=0, lease_token='dead'",
        );
        expect(await outbox.processNext()).toBe(true);
        expect((await delivery())[0]?.error_code).toBe("attempts_exhausted");
        await outbox.replay("order:1", "receipt");
        await outbox.processNext();
        expect((await delivery())[0]?.status).toBe("completed");
      },
    );
  });
  test("renewal keeps a slow listener owned while another worker polls", async () => {
    let enter!: () => void;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });

    await withOutboxes(
      [
        {
          leaseMs: 150,
          listeners: [
            listener(async () => {
              enter();
              await Bun.sleep(350);
            }),
          ],
        },
      ],
      async (fixture) => {
        const [outbox] = fixture.outboxes;
        if (!outbox) throw Error("Missing fixture coordinator");
        const { publish, delivery } = fixture;

        await publish(outbox);
        const running = outbox.processNext();
        await entered;
        await Bun.sleep(220);
        expect(await outbox.processNext()).toBe(false);
        await running;
        expect((await delivery())[0]?.status).toBe("completed");
      },
    );
  });
  test("lost ownership aborts the old handler and fences its acknowledgement", async () => {
    let entered!: () => void;
    const admission = new Promise<void>((resolve) => {
      entered = resolve;
    });
    await withOutboxes(
      [
        {
          leaseMs: 90,
          listeners: [
            listener(async (_, { signal }) => {
              entered();
              await new Promise<void>((resolve) =>
                signal.addEventListener("abort", () => resolve(), { once: true }),
              );
            }),
          ],
        },
      ],
      async (fixture) => {
        const [outbox] = fixture.outboxes;
        if (!outbox) throw Error("Missing fixture coordinator");
        const { db, publish, delivery } = fixture;

        await publish(outbox);
        const processing = outbox.processNext();
        await admission;
        await db.unsafe(
          "UPDATE strata_outbox_delivery SET lease_token='new-owner', status='completed', lease_until=NULL",
        );
        await processing;
        expect((await delivery())[0]?.status).toBe("completed");
      },
    );
  });
  test("captured tenant is resolved and missing/incorrect tenants fail closed", async () => {
    const seen: number[] = [];

    await withOutboxes(
      [
        {
          maxAttempts: 1,
          resolveTenant: async () => tenant,
          listeners: [
            listener(async (event) => {
              seen.push(Number(event.tenantId));
            }),
          ],
        },
        {
          maxAttempts: 1,
          resolveTenant: async () => null,
          listeners: [
            listener(async () => {
              throw new Error("must not run");
            }),
          ],
        },
      ],
      async (fixture) => {
        const [outbox, unavailable] = fixture.outboxes;
        if (!outbox || !unavailable) throw Error("Missing fixture coordinator");
        const { publish, delivery } = fixture;

        await publish(outbox, "order:1", { amount: 100 }, tenant.id);
        await outbox.processNext();
        expect(seen).toEqual([42]);

        await publish(unavailable, "order:2", { amount: 100 }, tenant.id);
        await unavailable.processNext();
        expect((await delivery())[1]?.status).toBe("failed");
      },
    );
  });
  test("removed or incompatible listeners retain their delivery for repair", async () => {
    await withOutboxes(
      [{ maxAttempts: 1, listeners: [listener(async () => {})] }, { listeners: [] }],
      async (fixture) => {
        const [original, removed] = fixture.outboxes;
        if (!original || !removed) throw Error("Missing fixture coordinator");
        const { publish, delivery } = fixture;

        await publish(original);

        await removed.processNext();
        expect((await delivery())[0]?.status).toBe("failed");
      },
    );
  });
  test("caller cancellation reaches the handler and never acknowledges success", async () => {
    const controller = new AbortController();

    await withOutboxes(
      [
        {
          maxAttempts: 1,
          listeners: [
            listener(async (_, { signal }) => {
              controller.abort();
              expect(signal.aborted).toBe(true);
            }),
          ],
        },
      ],
      async (fixture) => {
        const [outbox] = fixture.outboxes;
        if (!outbox) throw Error("Missing fixture coordinator");
        const { publish, delivery } = fixture;

        await publish(outbox);
        await expectCancellation(
          outbox.processNext({ signal: controller.signal }),
          controller.signal,
        );
        expect((await delivery())[0]?.status).toBe("failed");
        await expect(outbox.processNext({ signal: controller.signal })).rejects.toThrow();
        await expectCancellation(outbox.work({ signal: controller.signal }), controller.signal);
      },
    );
  });
  test("worker loop drains and wakes promptly from a long poll on cancellation", async () => {
    const controller = new AbortController();

    await withOutboxes(
      [
        {
          listeners: [
            listener(async () => {
              controller.abort();
            }),
          ],
        },
      ],
      async (fixture) => {
        const [outbox] = fixture.outboxes;
        if (!outbox) throw Error("Missing fixture coordinator");
        const { publish } = fixture;

        await publish(outbox);
        await expectCancellation(outbox.work({ signal: controller.signal }), controller.signal);
        const idle = new AbortController();
        const running = outbox.work({ signal: idle.signal, pollMs: 10_000 });
        await Bun.sleep(5);
        idle.abort();
        await running;
      },
    );
  });
  test("a caught publication failure cannot leave a partial listener snapshot", async () => {
    await withOutboxes(
      [
        {
          listeners: [listener(async () => {}), listener(async () => {}, "second")],
        },
      ],
      async (fixture) => {
        const [outbox] = fixture.outboxes;
        if (!outbox) throw Error("Missing fixture coordinator");
        const { db, delivery } = fixture;
        const connection = db;
        await connection.unsafe("CREATE TABLE business (value INTEGER)");
        await connection.unsafe(
          "CREATE TRIGGER reject_second BEFORE INSERT ON strata_outbox_delivery WHEN NEW.listener_name='second' BEGIN SELECT RAISE(ABORT, 'delivery rejected'); END",
        );

        await fixture.transaction(async (selected) => {
          await sessionSql(selected).unsafe("INSERT INTO business VALUES (1)");
          await expectNativeFailure(
            outbox.publish(selected, "orders.created", 1, { tenantId: null }),
            "delivery rejected",
          );
        });
        expect(await db.unsafe("SELECT * FROM business")).toEqual([{ value: 1 }]);
        expect(await db.unsafe("SELECT * FROM strata_outbox_event")).toEqual([]);
        expect(await delivery()).toEqual([]);
      },
    );
  });
  test("renewal SQL failure aborts cooperative effects and preserves the failed delivery", async () => {
    await withOutboxes(
      [
        {
          maxAttempts: 1,
          leaseMs: 90,
          listeners: [
            listener(async (_, { signal }) => {
              await new Promise<void>((resolve) =>
                signal.addEventListener("abort", () => resolve(), { once: true }),
              );
              expect(signal.aborted).toBe(true);
            }),
          ],
        },
      ],
      async (fixture) => {
        const [outbox] = fixture.outboxes;
        if (!outbox) throw Error("Missing fixture coordinator");
        const { db, publish, delivery } = fixture;
        const connection = db;
        await connection.unsafe(
          "CREATE TRIGGER reject_renew BEFORE UPDATE ON strata_outbox_delivery WHEN OLD.status='processing' AND NEW.status='processing' BEGIN SELECT RAISE(ABORT, 'renew unavailable'); END",
        );

        await publish(outbox);
        await outbox.processNext();
        expect((await delivery())[0]?.status).toBe("failed");
      },
    );
  });
  test("worker infrastructure failures propagate to the supervisor without deleting events", async () => {
    await withOutboxes([{ listeners: [listener(async () => {})] }], async (fixture) => {
      const [outbox] = fixture.outboxes;
      if (!outbox) throw Error("Missing fixture coordinator");
      const { db, publish } = fixture;
      const connection = db;

      await publish(outbox);
      await connection.unsafe("ALTER TABLE strata_outbox_delivery RENAME TO unavailable_delivery");
      await expectNativeFailure(
        outbox.work({ signal: new AbortController().signal }),
        "no such table",
      );
      expect((await db.unsafe("SELECT * FROM strata_outbox_event")).length).toBe(1);
    });
  });
  test("database abort retries are bounded and never repeat listener effects", async () => {
    let effects = 0;

    await withOutboxes(
      [
        {
          listeners: [
            listener(async () => {
              effects++;
            }),
          ],
        },
      ],
      async (fixture) => {
        const [outbox] = fixture.outboxes;
        if (!outbox) throw Error("Missing fixture coordinator");
        const { publish } = fixture;

        await publish(outbox);
        let aborted = 0;
        fixture.faults.beforeBegin = (policy) => {
          if (policy === "outbox.claim" && aborted++ < 2)
            return Object.assign(new Error("serialization abort"), {
              errno: "40001",
              code: "ERR_POSTGRES_SERVER_ERROR",
            });
          return undefined;
        };
        await outbox.processNext();
        expect(effects).toBe(1);
        let attempts = 0;
        fixture.faults.beforeBegin = (policy) => {
          if (policy !== "outbox.claim") return undefined;
          attempts++;
          return Object.assign(new Error("deadlock"), { errno: 1213 });
        };
        await expectNativeFailure(outbox.processNext(), "deadlock");
        expect(attempts).toBe(5);
      },
    );
  });
  test("non-error coordination failures propagate once without executing listener effects", async () => {
    let effects = 0;
    let attempts = 0;
    const failure = "unclassified transport failure";

    await withOutboxes(
      [
        {
          listeners: [
            listener(async () => {
              effects++;
            }),
          ],
        },
      ],
      async (fixture) => {
        const [outbox] = fixture.outboxes;
        if (!outbox) throw Error("Missing fixture coordinator");

        const before = { ...fixture.faults.disposal };
        fixture.faults.expectQuarantine = true;
        fixture.faults.unknownBegin = (policy) => {
          if (policy !== "outbox.claim") return undefined;
          attempts++;
          return failure;
        };
        const rejected = await outbox.processNext().catch((error: unknown) => error);
        const unknown = occurrences(rejected).filter(
          (error) =>
            error instanceof PersistenceError &&
            error.code === "DATABASE_TRANSACTION_UNKNOWN" &&
            error.data === "unknown" &&
            occurrences(error.cause).includes(failure),
        );
        expect(unknown.length).toBeGreaterThan(0);
        expect(fixture.faults.disposal.discards - before.discards).toBe(1);
        expect(fixture.faults.disposal.releases - before.releases).toBe(0);
        expect(attempts).toBe(1);
        expect(effects).toBe(0);
      },
    );
  });
  for (const stalledRoot of [2, 3])
    test(
      stalledRoot === 2
        ? "stalled lease renewal expires cooperatively and work remains recoverable"
        : "a stalled renewal after a successful heartbeat still expires and remains recoverable",
      async () => {
        await withOutboxes(
          [
            {
              leaseMs: 90,
              maxAttempts: 1,
              listeners: [
                listener(async (_, { signal }) => {
                  await new Promise<void>((resolve) =>
                    signal.addEventListener("abort", () => resolve(), { once: true }),
                  );
                  expect(signal.reason.message).toBe("Outbox lease expired.");
                }),
              ],
            },
          ],
          async (fixture) => {
            const [outbox] = fixture.outboxes;
            if (!outbox) throw Error("Missing fixture coordinator");
            const { publish, delivery } = fixture;

            await publish(outbox);
            let renewals = 0;
            fixture.faults.beforeInvoke = async (envelope) => {
              if (
                envelope.actor?.kind === "system" &&
                envelope.actor.policy === "outbox.renew" &&
                ++renewals === stalledRoot - 1
              )
                await Bun.sleep(130);
            };
            await outbox.processNext();
            expect((await delivery())[0]?.status).toBe("processing");
            await outbox.processNext();
            expect((await delivery())[0]?.error_code).toBe("attempts_exhausted");
          },
        );
      },
    );
  test("validates the contract before writes", async () => {
    await withOutboxes(
      [{ listeners: [listener(async () => {})], maxPayloadBytes: 10 }],
      async (fixture) => {
        const [outbox] = fixture.outboxes;
        if (!outbox) throw Error("Missing fixture coordinator");
        const { publish } = fixture;

        await expect(
          fixture.run((database) =>
            outbox.publish(database as never, "orders.created", 1, { tenantId: null }),
          ),
        ).rejects.toThrow("transaction");
        await expect(publish(outbox, "bad id")).rejects.toThrow("identifier");
        await expect(publish(outbox, "valid", undefined)).rejects.toThrow("oversized");
        await expect(
          fixture.transaction((selected) =>
            outbox.publish(selected, "orders.created", undefined, { tenantId: null }),
          ),
        ).rejects.toThrow("payload");
        await expect(
          fixture.transaction((selected) =>
            outbox.publish(selected, "missing", 1, { tenantId: null }),
          ),
        ).rejects.toThrow("No durable");
        await expect(
          fixture.transaction((selected) =>
            outbox.publish(selected, "orders.created", 1, { version: 0, tenantId: null }),
          ),
        ).rejects.toThrow("positive integer");
        expect(() =>
          createSqlOutboxBindings({
            invoke: fixture.invoke,
            connection: "main",
            tenancy: "none",
            leaseMs: 10,
            listeners: [],
          }),
        ).toThrow("at least 30");
        expect(() =>
          createSqlOutboxBindings({
            invoke: fixture.invoke,
            connection: "main",
            tenancy: "none",
            maxAttempts: 0,
            listeners: [],
          }),
        ).toThrow("positive integer");
        expect(() =>
          createSqlOutboxBindings({
            invoke: fixture.invoke,
            connection: "main",
            tenancy: "none",
            listeners: [listener(async () => {}), listener(async () => {})],
          }),
        ).toThrow("unique");
      },
    );
  });
});

test("public outbox declarations refuse incomplete owners and inert malformed listener metadata", () => {
  let effects = 0;
  const invoke = async () => {
    effects++;
    throw new Error("Invalid declarations must never invoke application work");
  };
  const options = { invoke, connection: "main", tenancy: "none" as const, listeners: [] };
  for (const invalid of [
    undefined,
    null,
    {},
    { ...options, invoke: undefined },
    { ...options, invoke: {} },
    { ...options, connection: undefined },
    { ...options, connection: " " },
    { ...options, tenancy: undefined },
    { ...options, tenancy: "unsupported" },
  ]) {
    expect(() => createSqlOutboxBindings(invalid as never)).toThrow(
      "Explicit outbox owner, connection and tenancy are required.",
    );
  }
  const accessor = (key: string, initial: object = {}) =>
    Object.defineProperty(initial, key, {
      enumerable: true,
      get() {
        effects++;
        throw new Error("Listener getter must remain inert");
      },
    });
  const inheritedName = Object.assign(Object.create({ name: "inherited" }), {
    event: "orders.created",
    handle: async () => {
      effects++;
    },
  });
  const inheritedEvent = Object.assign(Object.create({ event: "orders.created" }), {
    name: "receipt",
    handle: async () => {
      effects++;
    },
  });
  const handle = async () => {
    effects++;
  };
  const malformed = [
    [null],
    new Array(1),
    accessor("0", [listener(handle)]),
    [accessor("name", { event: "orders.created", handle })],
    [accessor("event", { name: "receipt", handle })],
    [inheritedName],
    [inheritedEvent],
    [{ name: "receipt", event: "orders.created" }],
    [{ name: "receipt", event: "orders.created", handle: 7 }],
    [accessor("handle", { name: "receipt", event: "orders.created" })],
  ];
  for (const listeners of malformed)
    expect(() => createSqlOutboxBindings({ ...options, listeners } as never)).toThrow();
  const coercible = {
    get length() {
      effects++;
      return 7;
    },
    toString() {
      effects++;
      return "receipt";
    },
  };
  for (const field of ["name", "event"] as const) {
    for (const value of [7, true, ["receipt"], coercible]) {
      expect(() =>
        createSqlOutboxBindings({
          ...options,
          listeners: [{ name: "receipt", event: "orders.created", handle, [field]: value }],
        } as never),
      ).toThrow("Invalid durable event/listener identifier.");
    }
  }
  expect(effects).toBe(0);
  for (const owner of [undefined, null, {}, Object.freeze({})]) {
    expect(() => new SqlOutbox({ owner, tenancy: "none", listeners: [] } as never)).toThrow(
      "Outbox requires its original graph-owned identity.",
    );
  }
  expect(effects).toBe(0);
});

test("factory listener snapshot preserves own metadata and inherited class handle receiver on actual delivery", async () => {
  class ReceiptHandler {
    #value = "original-private-receiver";
    async handle(
      _event: Parameters<DurableListener["handle"]>[0],
      context: Parameters<DurableListener["handle"]>[1],
    ) {
      await context.database.execute({
        text: "INSERT INTO class_receipts VALUES (?)",
        params: [this.#value],
      });
    }
  }
  class Receipt extends ReceiptHandler {
    name = "receipt";
    event = "orders.created";
  }
  const receipt = new Receipt();
  await withOutboxes([{ listeners: [receipt] }], async (fixture) => {
    const outbox = fixture.outboxes[0];
    if (!outbox) throw new Error("Missing genuine coordinator");
    await fixture.db.unsafe("CREATE TABLE class_receipts (value TEXT)");
    receipt.name = "mutated";
    receipt.event = "mutated";
    expect(outbox.hasListener("receipt", "orders.created")).toBe(true);
    expect(outbox.hasListener("mutated")).toBe(false);
    await fixture.publish(outbox);
    expect(await outbox.processNext()).toBe(true);
    expect(await fixture.db.unsafe("SELECT value FROM class_receipts")).toEqual([
      { value: "original-private-receiver" },
    ]);
    expect(await fixture.inspect(outbox, "order:1", "receipt")).toEqual({
      status: "completed",
      attempts: 1,
      maxAttempts: 5,
    });
  });
});

test("public selected publication rejects malformed immutable origin and option fields before publication SQL", async () => {
  let canonical: PersistenceInvocation;
  const binding = createSqlOutboxBindings({
    invoke: (input, work) => canonical(input, work),
    connection: "main",
    tenancy: "column",
    listeners: [listener(async () => {})],
  });
  let statements = 0;
  const owner = await createNativePersistenceApplication(
    {
      default: "main",
      preparation: [binding.token],
      connections: { main: { driver: "sqlite", filename: ":memory:" } },
    },
    () => {
      statements++;
    },
    binding.services,
  );
  canonical = createPersistenceInvocation(owner.application, "main");
  try {
    const outbox = await owner.application.run((scope) => scope.resolve(binding.token));
    await owner.run((db) => createOutboxMigration("boundary", "sqlite").up(sessionSql(db)));
    const origins: readonly ApplicationConfig[] = [
      {},
      { id: "42" },
      { id: null },
      { id: 0 },
      { id: -1 },
    ];
    for (const origin of origins) {
      await canonical({ kind: "command", tenant: origin }, (ports) =>
        ports.database.transaction((selected) => {
          const before = statements;
          expect(() =>
            outbox.publish(selected, "orders.created", {}, { tenantId: null }),
          ).toThrow();
          expect(statements).toBe(before);
        }),
      );
    }
    let getterEffects = 0;
    const accessor = Object.defineProperty({}, "tenantId", {
      get() {
        getterEffects++;
        return 42;
      },
    });
    await canonical({ kind: "command", tenant: { id: 42 } }, (ports) =>
      ports.database.transaction(async (selected) => {
        for (const options of [{}, Object.create({ tenantId: 42 }), accessor]) {
          const before = statements;
          expect(() => outbox.publish(selected, "orders.created", {}, options as never)).toThrow(
            "Outbox metadata requires own data fields.",
          );
          expect(statements).toBe(before);
        }
        expect(getterEffects).toBe(0);
        const before = statements;
        expect(() => outbox.publish(selected, "orders.created", {}, { tenantId: 43 })).toThrow(
          "Outbox publication tenant must match its immutable execution.",
        );
        expect(statements).toBe(before);
        const coercible = {
          get length() {
            getterEffects++;
            return 7;
          },
          toString() {
            getterEffects++;
            return "valid-origin";
          },
        };
        for (const value of [7, coercible]) {
          await expect(outbox.getDelivery(selected, value as never, "receipt")).rejects.toThrow(
            "Invalid durable event/listener identifier.",
          );
          await expect(
            outbox.getDelivery(selected, "valid-origin", value as never),
          ).rejects.toThrow("Invalid durable event/listener identifier.");
          await expect(
            outbox.publish(selected, value as never, {}, { tenantId: 42 }),
          ).rejects.toThrow("Invalid durable event/listener identifier.");
          await expect(
            outbox.publish(selected, "orders.created", {}, { tenantId: 42, id: value as never }),
          ).rejects.toThrow("Invalid durable event/listener identifier.");
          expect(statements).toBe(before);
          expect(getterEffects).toBe(0);
        }
        await outbox.publish(
          selected,
          "orders.created",
          { accepted: true },
          { tenantId: 42, id: "valid-origin" },
        );
      }),
    );
    await owner.run(async (db) => {
      expect(
        await db.execute({ text: "SELECT id,tenant_id FROM strata_outbox_event", params: [] }),
      ).toEqual([{ id: "valid-origin", tenant_id: 42 }]);
    });
  } finally {
    await owner.close();
  }
});

test("delivery reader refuses malformed stored snapshots from actual SQLite selected reads", async () => {
  await withOutboxes([{ listeners: [listener(async () => {})] }], async (fixture) => {
    const outbox = fixture.outboxes[0];
    if (!outbox) throw new Error("Missing genuine coordinator");
    await fixture.publish(outbox);
    // SQLite INTEGER affinity permits these nonintegral/nonnumeric values despite
    // the official positivity CHECKs. These are explicit legacy/corrupt-row fixtures.
    for (const assignments of [
      "attempts=0.5",
      "attempts='invalid'",
      "max_attempts=1.5",
      "max_attempts='invalid'",
    ]) {
      await fixture.db.unsafe(
        `UPDATE strata_outbox_delivery SET attempts=0,max_attempts=5,${assignments}`,
      );
      await expect(fixture.inspect(outbox, "order:1", "receipt")).rejects.toThrow(
        "Invalid outbox delivery snapshot.",
      );
    }
    await fixture.db.unsafe("UPDATE strata_outbox_delivery SET attempts=0,max_attempts=5");
    expect(await fixture.inspect(outbox, "order:1", "receipt")).toEqual({
      status: "pending",
      attempts: 0,
      maxAttempts: 5,
    });
  });
  await withOutboxes(
    [{ listeners: [] }],
    async (fixture) => {
      const outbox = fixture.outboxes[0];
      if (!outbox) throw new Error("Missing genuine coordinator");
      // Explicit alternate legacy schema: official migration rejects invalid status.
      // This proves the public reader boundary, not production-schema write behavior.
      await fixture.db.unsafe(
        "CREATE TABLE strata_outbox_delivery (event_id TEXT,listener_name TEXT,status TEXT,attempts INTEGER,max_attempts INTEGER)",
      );
      await fixture.db.unsafe(
        "INSERT INTO strata_outbox_delivery VALUES ('legacy','receipt','unrecognized',0,5)",
      );
      await expect(fixture.inspect(outbox, "legacy", "receipt")).rejects.toThrow(
        "Invalid outbox delivery snapshot.",
      );
      expect(await fixture.inspect(outbox, "absent", "receipt")).toBeNull();
    },
    { migrate: false },
  );
});

test("outbox binding captures each public option once and uses only the validated snapshot for real delivery", async () => {
  let canonical: PersistenceInvocation;
  const reads = { invoke: 0, connection: 0, tenancy: 0, listeners: 0 };
  let effects = 0;
  const listeners = [
    listener(async () => {
      effects++;
    }),
  ];
  const options = {
    get invoke() {
      reads.invoke++;
      return reads.invoke === 1
        ? (((input, work) => canonical(input, work)) as PersistenceInvocation)
        : null;
    },
    get connection() {
      reads.connection++;
      return reads.connection === 1 ? "main" : "missing";
    },
    get tenancy() {
      reads.tenancy++;
      return reads.tenancy === 1 ? "none" : "unsupported";
    },
    get listeners() {
      reads.listeners++;
      return reads.listeners === 1 ? listeners : [];
    },
  };
  const binding = createSqlOutboxBindings(options as never);
  expect(reads).toEqual({ invoke: 1, connection: 1, tenancy: 1, listeners: 1 });
  const owner = await createNativePersistenceApplication(
    {
      default: "main",
      preparation: [binding.token],
      connections: { main: { driver: "sqlite", filename: ":memory:" } },
    },
    undefined,
    binding.services,
  );
  canonical = createPersistenceInvocation(owner.application, "main");
  try {
    const outbox = await owner.application.run((scope) => scope.resolve(binding.token));
    await owner.run((db) => createOutboxMigration("captured", "sqlite").up(sessionSql(db)));
    await canonical({ kind: "command" }, (ports) =>
      ports.database.transaction((selected) =>
        outbox.publish(selected, "orders.created", {}, { tenantId: null, id: "captured" }),
      ),
    );
    expect(await outbox.processNext()).toBe(true);
    expect(effects).toBe(1);
    expect(reads).toEqual({ invoke: 1, connection: 1, tenancy: 1, listeners: 1 });
    await owner.run(async (db) => {
      expect(await outbox.getDelivery(db, "captured", "receipt")).toEqual({
        status: "completed",
        attempts: 1,
        maxAttempts: 5,
      });
    });
  } finally {
    await owner.close();
  }
  for (const field of ["invoke", "connection", "tenancy"] as const) {
    let count = 0;
    const invalid = {
      invoke: async () => {
        throw new Error("Invalid binding cannot run");
      },
      connection: "main",
      tenancy: "none",
      listeners: [],
    };
    Object.defineProperty(invalid, field, {
      enumerable: true,
      get() {
        count++;
        return field === "invoke" ? null : "";
      },
    });
    expect(() => createSqlOutboxBindings(invalid as never)).toThrow(
      "Explicit outbox owner, connection and tenancy are required.",
    );
    expect(count).toBe(1);
  }
});

test("delegated original invocation protocol faults bound retries and preserve unknown or committed errors without listener effects", async () => {
  let canonical: PersistenceInvocation;
  let failure: unknown;
  let attempts = 0;
  let effects = 0;
  let statements = 0;
  const binding = createSqlOutboxBindings({
    connection: "main",
    tenancy: "none",
    listeners: [
      listener(async () => {
        effects++;
      }),
    ],
    invoke: (input, work) =>
      canonical(input, (ports) => {
        if (input.actor?.kind === "system" && input.actor.policy === "outbox.claim") {
          attempts++;
          if (failure !== undefined) throw failure;
        }
        return work(ports);
      }),
  });
  const owner = await createNativePersistenceApplication(
    {
      default: "main",
      preparation: [binding.token],
      connections: { main: { driver: "sqlite", filename: ":memory:" } },
    },
    () => {
      statements++;
    },
    binding.services,
  );
  canonical = createPersistenceInvocation(owner.application, "main");
  try {
    const outbox = await owner.application.run((scope) => scope.resolve(binding.token));
    await owner.run((db) => createOutboxMigration("retry-protocol", "sqlite").up(sessionSql(db)));
    const retryable = Object.assign(new Error("fixed protocol retry sentinel"), { code: "40001" });
    const independent = new Error("independent protocol occurrence");
    for (const [error, expected] of [
      [retryable, 5],
      [
        new PersistenceError("DATABASE_TRANSACTION_UNKNOWN", { cause: retryable, data: "unknown" }),
        1,
      ],
      [
        new PersistenceError("DATABASE_OPERATION_FAILED", { cause: retryable, data: "committed" }),
        1,
      ],
      [new AggregateError([retryable, independent], "independent protocol failures"), 1],
    ] as const) {
      failure = error;
      attempts = 0;
      const before = statements;
      const rejected = await outbox.processNext().catch((caught: unknown) => caught);
      expect(rejected).toBe(error);
      expect(attempts).toBe(expected);
      expect(statements).toBe(before);
      expect(effects).toBe(0);
      if (error instanceof AggregateError) expect(error.errors).toEqual([retryable, independent]);
    }
    // This is an explicit invocation-boundary protocol fault, not a native
    // COMMIT/ACK, lost connection, quarantine or disposition witness.
    failure = undefined;
    const beforeRecovery = statements;
    expect(await outbox.processNext()).toBe(false);
    expect(statements).toBeGreaterThan(beforeRecovery);
  } finally {
    await owner.close();
  }
});
