import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import type { ExecutionEnvelope } from "../../src/core/contracts/application";
import { Job } from "../../src/core/queue/index";
import { JobRegistry } from "../../src/core/queue/jobRegistry";
import {
  parseQueueJobEnvelope,
  runQueueJob,
  snapshotQueueJobEnvelope,
} from "../../src/core/queue/jobRunner";
import { createIdentityQueue, createQueueHandoff } from "../../src/core/queue/queueHandoff";
import { createSystemQueueServices } from "../../src/core/queue/queueServices";
import { ResilientQueue } from "../../src/core/queue/resilientQueue";
import { withQueuePersistence } from "../helpers/queuePersistence";

const identity = {
  actor: { kind: "principal" as const, claims: { id: 7, role: "member" } },
  tenant: { id: 11 },
};
const key = new Uint8Array(32).fill(71);
const policy = { maxAttempts: 2, backoffMs: 0 };

describe("authenticated queue identity handoff", () => {
  test("snapshots explicit identity, enters fresh owned attempts after producer execution closes, retries stable identity", async () => {
    await withQueuePersistence(async (fixture) => {
      const handoff = createQueueHandoff({ key, audience: "app-a" });
      const envelopes: ExecutionEnvelope[] = [];
      const sessions: unknown[] = [];
      const services = createSystemQueueServices(
        (envelope, work) => {
          envelopes.push(envelope);
          return fixture.invoke(envelope, (ports) => {
            sessions.push(ports.database);
            return work(ports);
          });
        },
        {},
        handoff,
      );
      const registry = new JobRegistry();
      let attempts = 0;
      const ids: string[] = [];
      class Work extends Job<{ value: number }> {
        async handle(
          payload: { value: number },
          context?: import("../../src/core/queue/index").JobContext,
        ) {
          expect(payload.value).toBe(3);
          expect(context?.database).toBeDefined();
          ids.push(context!.jobId);
          if (++attempts === 1) throw new Error("retry");
        }
      }
      registry.register("work", () => new Work());
      const job = registry.track("work", new Work());
      const queue = new ResilientQueue(services, registry, true, policy);
      const mutable = structuredClone(identity);
      let dispatcher!: ReturnType<typeof createIdentityQueue>;
      await fixture.application.run({ kind: "request", ...mutable }, () => {
        dispatcher = createIdentityQueue(queue, registry, handoff, mutable);
      });
      mutable.actor.claims.id = 999;
      mutable.tenant.id = 999;
      await dispatcher.dispatch(job, { value: 3 });
      await queue.close();
      expect(attempts).toBe(2);
      expect(new Set(ids).size).toBe(1);
      expect(envelopes).toHaveLength(2);
      for (const envelope of envelopes)
        expect({ actor: envelope.actor, tenant: envelope.tenant }).toEqual(identity);
      expect(sessions[0]).not.toBe(sessions[1]);
    });
  });
  test("tampering, wrong audience/key, raw principal, malformed tokens and unconfigured verifier fail before factory/invoke", async () => {
    await withQueuePersistence(async (fixture) => {
      const handoff = createQueueHandoff({ key, audience: "app-a" });
      const registry = new JobRegistry();
      let factories = 0;
      let invocations = 0;
      class Work extends Job {
        async handle() {
          throw new Error("must not run");
        }
      }
      registry.register("work", () => {
        factories++;
        return new Work();
      });
      registry.register("other", () => {
        factories++;
        return new Work();
      });
      const good = {
        name: "work",
        payload: { value: 1 },
        handoff: handoff.seal("work", { value: 1 }, identity),
      };
      const body = JSON.parse(
        Buffer.from(good.handoff.split(".")[0]!, "base64url").toString("utf8"),
      );
      const signedRaw = (raw: string) => {
        const encoded = Buffer.from(raw).toString("base64url");
        return `${encoded}.${createHmac("sha256", key).update(encoded).digest("base64url")}`;
      };
      const malformedSigned = [
        "{",
        JSON.stringify({ ...body, version: 2 }),
        JSON.stringify({ ...body, extra: true }),
        JSON.stringify({ ...body, identity: { actor: { kind: "principal", claims: [] } } }),
        JSON.stringify({ ...body, identity: { ...identity, tenant: [] } }),
        JSON.stringify({ ...body, identity: { ...identity, kind: "request" } }),
        JSON.stringify({ ...body, identity: { ...identity, scope: "forbidden" } }),
      ].map((raw) => ({ ...good, handoff: signedRaw(raw) }));
      const services = createSystemQueueServices(
        (envelope, work) => {
          invocations++;
          return fixture.invoke(envelope, work);
        },
        {},
        handoff,
      );
      for (const bad of [
        ...malformedSigned,
        { ...good, handoff: undefined },
        { ...good, payload: { value: 2 } },
        { ...good, name: "other" },
        { ...good, handoff: good.handoff.slice(0, -2) + "aa" },
        { ...good, handoff: "x.y" },
        { ...good, handoff: "a.b.c" },
        {
          ...good,
          handoff: createQueueHandoff({ key, audience: "app-b" }).seal(
            "work",
            good.payload,
            identity,
          ),
        },
        {
          ...good,
          handoff: createQueueHandoff({ key: new Uint8Array(32), audience: "app-a" }).seal(
            "work",
            good.payload,
            identity,
          ),
        },
      ])
        await expect(
          runQueueJob(bad, services, registry, { retryPolicy: policy }),
        ).rejects.toThrow();
      await expect(
        runQueueJob(good, createSystemQueueServices(fixture.invoke), registry, {
          retryPolicy: policy,
        }),
      ).rejects.toThrow("handoff is invalid");
      expect(factories).toBe(0);
      expect(invocations).toBe(0);
      expect(
        parseQueueJobEnvelope(
          JSON.stringify({
            name: "work",
            payload: {},
            actor: identity.actor,
            tenant: identity.tenant,
          }),
          registry,
        ),
      ).toBeNull();
      for (const handoff of [null, 7, {}, "", "x".repeat(32769)])
        expect(
          parseQueueJobEnvelope(JSON.stringify({ name: "work", payload: {}, handoff }), registry),
        ).toBeNull();
    });
  });
  test("system jobs keep deliberate policy; failed signed identity survives SQL storage and manual replay", async () => {
    await withQueuePersistence(async (fixture) => {
      const handoff = createQueueHandoff({ key, audience: "app-a" });
      const seen: ExecutionEnvelope[] = [];
      const services = createSystemQueueServices(
        (envelope, work) => {
          seen.push(envelope);
          return fixture.invoke(envelope, work);
        },
        {},
        handoff,
        ["work"],
      );
      const registry = new JobRegistry();
      const ids: string[] = [];
      let fail = true;
      class Work extends Job {
        override readonly maxAttempts = 1;
        async handle(_payload: object, context?: import("../../src/core/queue/index").JobContext) {
          ids.push(context!.jobId);
          if (fail) throw new Error("failure");
        }
      }
      registry.register("work", () => new Work());
      const job = registry.track("work", new Work());
      const queue = new ResilientQueue(services, registry, false, policy);
      await expect(
        createIdentityQueue(queue, registry, handoff, identity).dispatch(job, {}),
      ).rejects.toThrow("failure");
      const [stored] = await services.listRecent();
      expect(stored?.handoff).toBeString();
      let replayAdmissions = 0;
      await fixture.run((db) =>
        db.execute({
          text: "UPDATE failed_job SET payload=$1 WHERE id=$2",
          params: [JSON.stringify({ tampered: true }), stored!.id],
        }),
      );
      await expect(
        services.retry(stored!.id, async () => {
          replayAdmissions++;
        }),
      ).rejects.toThrow("handoff is invalid");
      expect(replayAdmissions).toBe(0);
      expect(await services.listRecent()).toHaveLength(1);
      await fixture.run((db) =>
        db.execute({
          text: "UPDATE failed_job SET payload=$1 WHERE id=$2",
          params: [JSON.stringify(stored!.payload), stored!.id],
        }),
      );
      fail = false;
      await services.retry(stored!.id, (record) =>
        queue.replay(job, record.payload, record.job_id!, { handoff: record.handoff! }),
      );
      expect(ids[0]).toBe(ids[1]);
      expect(await services.listRecent()).toEqual([]);
      const attempts = seen.filter((entry) => entry.kind === "job");
      expect(attempts.map((entry) => entry.actor)).toEqual([identity.actor, identity.actor]);
      await queue.dispatch(job, {});
      expect(seen.at(-1)?.actor).toEqual({ kind: "system", policy: "queue.job" });
      await queue.close();
    });
  });
  test("authenticated payload/name remain immutable while invocation acquires resources and across retries", async () => {
    await withQueuePersistence(async (fixture) => {
      const handoff = createQueueHandoff({ key, audience: "barrier" });
      let enter!: () => void;
      let release!: () => void;
      const entered = new Promise<void>((resolve) => {
        enter = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const services = createSystemQueueServices(
        async (envelope, work) => {
          enter();
          await gate;
          return fixture.invoke(envelope, work);
        },
        {},
        handoff,
      );
      const observed: object[] = [];
      let wrongFactories = 0;
      const registry = new JobRegistry();
      class Work extends Job {
        async handle(payload: object) {
          observed.push(payload);
          expect(Object.isFrozen(payload)).toBe(true);
          if (observed.length === 1) throw new Error("retry after snapshot");
        }
      }
      registry.register("work", () => new Work());
      registry.register("wrong", () => {
        wrongFactories++;
        return new Work();
      });
      const original = { amount: 1, nested: { amount: 2 } };
      const envelope = {
        name: "work",
        payload: original,
        handoff: handoff.seal("work", original, identity),
      };
      const pending = runQueueJob(envelope, services, registry, { retryPolicy: policy });
      await entered;
      envelope.name = "wrong";
      original.amount = 999;
      original.nested.amount = 999;
      envelope.handoff = "tampered.after.admission";
      release();
      await pending;
      expect(observed).toEqual([
        { amount: 1, nested: { amount: 2 } },
        { amount: 1, nested: { amount: 2 } },
      ]);
      expect(wrongFactories).toBe(0);
      const job = registry.track("work", new Work());
      const queue = new ResilientQueue(services, registry, true, policy);
      const payload = { amount: 3 };
      await queue.dispatch(job, payload, { handoff: handoff.seal("work", payload, identity) });
      payload.amount = 999;
      await queue.close();
      expect(observed.at(-1)).toEqual({ amount: 3 });
    });
  });
  test("queue admission snapshots reject nondata envelopes without invoking accessors", () => {
    let reads = 0;
    const envelope = {
      name: "work",
      get payload() {
        reads++;
        return {};
      },
    };
    expect(() => snapshotQueueJobEnvelope(envelope)).toThrow("own data");
    expect(reads).toBe(0);
    expect(() =>
      snapshotQueueJobEnvelope({ name: "work", payload: {}, actor: identity.actor } as never),
    ).toThrow("Unknown");
    expect(() => snapshotQueueJobEnvelope([] as never)).toThrow("plain data");
    expect(() => snapshotQueueJobEnvelope({ name: "", payload: {} })).toThrow("job name");
  });
  test("construction rejects weak keys, invalid audiences, malformed identities and oversized claims; keys copied", () => {
    expect(() => createQueueHandoff({ key: new Uint8Array(31), audience: "a" })).toThrow();
    expect(() => createQueueHandoff({ key, audience: " " })).toThrow();
    const mutable = new Uint8Array(key);
    const handoff = createQueueHandoff({ key: mutable, audience: "a" });
    for (const name of ["", "x".repeat(257)])
      expect(() => handoff.seal(name, {}, identity)).toThrow("Invalid handoff job name");
    expect(() => handoff.verify({ name: "work", payload: {} })).toThrow("handoff is invalid");
    expect(() => handoff.verify({ name: "work", payload: {}, handoff: "x".repeat(32769) })).toThrow(
      "handoff is invalid",
    );
    let reads = 0;
    const accessorIdentity = {
      get actor() {
        reads++;
        return identity.actor;
      },
    };
    expect(() => handoff.seal("work", {}, accessorIdentity)).toThrow("accessors");
    expect(reads).toBe(0);
    expect(() =>
      createSystemQueueServices(
        async () => {
          throw new Error("must not invoke");
        },
        {},
        handoff,
        [""],
      ),
    ).toThrow("explicit job names");
    const token = handoff.seal("work", {}, identity);
    const orderedToken = handoff.seal("work", { longer: 1, a: { z: 2, b: 3 } }, identity);
    expect(
      handoff.verify({
        name: "work",
        payload: { a: { b: 3, z: 2 }, longer: 1 },
        handoff: orderedToken,
      }),
    ).toEqual(identity);
    mutable.fill(0);
    expect(handoff.verify({ name: "work", payload: {}, handoff: token })).toEqual(identity);
    expect(() =>
      handoff.seal(
        "work",
        {},
        { actor: { kind: "principal", claims: { data: "x".repeat(40000) } } },
      ),
    ).toThrow("too large");
    expect(() => handoff.seal("work", {}, { actor: { kind: "system", policy: "" } })).toThrow();
  });
});
