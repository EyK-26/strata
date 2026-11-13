import { describe, expect, test } from "bun:test";
import { runWithAuthUser } from "@getstrata/core/auth/authContext";
import { Policy, PolicyDeniedError, PolicyGate } from "@getstrata/core/auth/policy";
import { createAuthorizeMiddleware } from "@getstrata/core/http/authorizeMiddleware";
import { withJsonErrorHandling } from "@getstrata/core/http/response";
import { securedBindRouteModel } from "@getstrata/core/http/securedRouteModelBinding";
import { createApplication } from "@getstrata/core/runtime/application";
import { deferred } from "../fixtures/applicationOwnershipSupport";

const request = () => new Request("http://example.test/records/1");
const guest = { resolve: async () => null };

describe("awaited policy decisions", () => {
  test("retains the private-field receiver across an async decision", async () => {
    class OwnedPolicy extends Policy {
      #owner = "actor";
      async inspect(user: { id: string }, model: { owner: string }) {
        await Promise.resolve();
        return user.id === this.#owner && model.owner === this.#owner;
      }
    }
    const gate = new PolicyGate({ records: new OwnedPolicy() });
    expect(await gate.allows("records", "inspect", { id: "actor" }, { owner: "actor" })).toBe(true);
    await expect(
      gate.authorize("records", "inspect", { id: "other" }, { owner: "actor" }),
    ).rejects.toBeInstanceOf(PolicyDeniedError);
  });

  test("never grants a truthy non-boolean decision", async () => {
    const gate = new PolicyGate();
    for (const result of [1, "true", {}, [], null, undefined]) {
      gate.register("records", { view: () => result } as never);
      expect(await gate.allows("records", "view", null)).toBe(false);
      gate.register("records", { view: async () => result } as never);
      await expect(gate.authorize("records", "view", null)).rejects.toBeInstanceOf(
        PolicyDeniedError,
      );
    }
  });

  test("denies unknown actions, non-functions and Object prototype methods", async () => {
    const gate = new PolicyGate();
    gate.register(
      "records",
      new (class extends Policy {
        override view() {
          return true;
        }
      })(),
    );
    expect(await gate.allows("records", "view", null)).toBe(true);
    for (const action of [
      null,
      undefined,
      1,
      {},
      { toString: () => "view" },
      Symbol("view"),
      "missing",
      "constructor",
      "toString",
      "__defineGetter__",
      "__lookupGetter__",
    ]) {
      // Exercise untrusted runtime input which TypeScript rejects for callers.
      expect(await gate.allows("records", action as "view", null)).toBe(false);
    }
    expect(await gate.allows("missing", "view", null)).toBe(false);
  });

  test("propagates synchronous and asynchronous operational errors without granting", async () => {
    const failure = new Error("policy lookup failed");
    for (const view of [
      () => {
        throw failure;
      },
      async () => {
        throw failure;
      },
    ]) {
      const gate = new PolicyGate();
      gate.register("records", { view } as never);
      await expect(gate.allows("records", "view", null)).rejects.toBe(failure);
      await expect(gate.authorize("records", "view", null)).rejects.toBe(failure);
    }
  });

  test.each([false, true])(
    "HTTP waits for a pending %s decision before invoking downstream",
    async (allowed) => {
      const decision = deferred<boolean>();
      const entered = deferred();
      class PendingPolicy extends Policy {
        override async view() {
          entered.resolve();
          return decision.promise;
        }
      }
      const gate = new PolicyGate();
      gate.register("records", new PendingPolicy());
      let handled = false;
      const response = createAuthorizeMiddleware(
        gate,
        guest,
        "records",
        "view",
      )(request(), async () => {
        handled = true;
        return new Response("ok");
      });
      await entered.promise;
      expect(handled).toBe(false);
      decision.resolve(allowed);
      expect((await response).status).toBe(allowed ? 200 : 403);
      expect(handled).toBe(allowed);
    },
  );

  test("HTTP maps an async policy exception to an internal error and never invokes downstream", async () => {
    class BrokenPolicy extends Policy {
      override async view(): Promise<boolean> {
        throw new Error("policy database unavailable");
      }
    }
    const gate = new PolicyGate();
    gate.register("records", new BrokenPolicy());
    let handled = false;
    const middleware = createAuthorizeMiddleware(gate, guest, "records", "view");
    const response = await withJsonErrorHandling((request: Request) =>
      middleware(request, async () => {
        handled = true;
        return new Response("ok");
      }),
    )(request());
    expect(response.status).toBe(500);
    expect(handled).toBe(false);
  });

  test("secured model binding awaits denial and maps the domain error to HTTP 403", async () => {
    class DenyPolicy extends Policy {
      override async view() {
        return false;
      }
    }
    const gate = new PolicyGate();
    gate.register("records", new DenyPolicy());
    let handled = false;
    const handler = securedBindRouteModel(
      "id",
      async (id) => ({ id }),
      { resource: "records", action: "view" },
      async () => {
        handled = true;
        return new Response("ok");
      },
      { auth: guest, authorize: gate.authorize.bind(gate), etagEnabled: false },
    );
    const input = request() as Request & { params: { id: string } };
    input.params = { id: "1" };
    expect((await withJsonErrorHandling(handler)(input)).status).toBe(403);
    expect(handled).toBe(false);
  });

  test("parallel explicit actors and missing actors never borrow ambient HTTP identity", async () => {
    const seen: unknown[] = [];
    class ActorPolicy extends Policy {
      override async view(user: unknown) {
        await Promise.resolve();
        seen.push(user);
        return user !== undefined && user !== null;
      }
    }
    const gate = new PolicyGate();
    gate.register("records", new ActorPolicy());
    const actors = [{ id: "first" }, { id: "second" }];
    await Promise.all(
      actors.map((actor) =>
        runWithAuthUser({ id: "ambient" }, async () => {
          expect(await gate.allows("records", "view", actor)).toBe(true);
          expect(await gate.allows("records", "view", undefined)).toBe(false);
          expect(await gate.allows("records", "view", null)).toBe(false);
        }),
      ),
    );
    expect(seen.filter(Boolean)).toEqual(actors);
  });

  test("job authorization uses the deliberate actor envelope despite an ambient HTTP user", async () => {
    class JobPolicy extends Policy {
      execute(actor: { kind: string; claims?: { id?: unknown }; policy?: string }) {
        return actor.kind === "principal" && actor.claims?.id === "job-actor";
      }
    }
    const gate = new PolicyGate({ jobs: new JobPolicy() });
    const app = createApplication({ providers: [] });
    await app.start();
    try {
      await runWithAuthUser({ id: "http-admin", role: "admin" }, async () => {
        await app.run(
          { kind: "job", actor: { kind: "principal", claims: { id: "job-actor" } } },
          async (scope) => {
            const actor = scope.context.actor;
            if (!actor) throw new Error("Job actor missing");
            await gate.authorize("jobs", "execute", actor);
          },
        );
        await app.run(
          { kind: "job", actor: { kind: "system", policy: "cleanup" } },
          async (scope) => {
            const actor = scope.context.actor;
            if (!actor) throw new Error("Job actor missing");
            await expect(gate.authorize("jobs", "execute", actor)).rejects.toBeInstanceOf(
              PolicyDeniedError,
            );
          },
        );
      });
    } finally {
      await app.stop();
    }
  });
});
