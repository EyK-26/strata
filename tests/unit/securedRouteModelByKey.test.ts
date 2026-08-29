import { describe, expect, test } from "bun:test";
import { CORE_AUTH_TOKEN, CORE_POLICY_GATE_TOKEN } from "@getstrata/bootstrap/config";
import { ServiceContainer } from "@getstrata/bootstrap/contracts";
import { runWithAuthUser } from "@getstrata/core/auth/authContext";
import { Policy, PolicyGate } from "@getstrata/core/auth/policy";
import { NotFoundError } from "@getstrata/core/errors/http";
import { securedBindRouteModelByKey } from "@getstrata/core/http/securedRouteModelBinding";
import { setActiveApplicationContext } from "@getstrata/core/runtime/applicationRegistry";

class PublicForumPolicy extends Policy {
  override view() {
    return true;
  }
}

describe("securedBindRouteModelByKey", () => {
  test("resolves string route keys and authorizes before handling", async () => {
    const gate = new PolicyGate();
    gate.register("forum", new PublicForumPolicy());

    const container = new ServiceContainer();
    container.set(CORE_POLICY_GATE_TOKEN, gate);
    container.set(CORE_AUTH_TOKEN, {
      resolve: async () => null,
    });

    setActiveApplicationContext({
      container,
      config: {
        get: <T>() => undefined as T,
        set: <T>(_key: string, value: T) => value,
        has: () => false,
        require: () => {
          throw new Error("missing");
        },
      } as never,
      dependencies: {
        container,
        cache: undefined as never,
        policyGate: gate,
        queue: undefined as never,
      } as never,
    });

    const handler = securedBindRouteModelByKey(
      "slug",
      async (slug) => ({ slug }),
      { resource: "forum", action: "view" },
      async (_request, model) => Response.json(model),
    );

    const request = new Request("http://localhost/forum/general/welcome") as Request & {
      params: { slug: string };
    };
    request.params = { slug: "welcome" };

    const response = await runWithAuthUser(null, () => handler(request));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ slug: "welcome" });
    expect(response.headers.get("etag")).toBeNull();
  });

  test("throws NotFoundError when the resolver returns null", async () => {
    const gate = new PolicyGate();
    gate.register("forum", new PublicForumPolicy());

    const container = new ServiceContainer();
    container.set(CORE_POLICY_GATE_TOKEN, gate);
    container.set(CORE_AUTH_TOKEN, {
      resolve: async () => null,
    });

    setActiveApplicationContext({
      container,
      config: {
        get: <T>() => undefined as T,
        set: <T>(_key: string, value: T) => value,
        has: () => false,
        require: () => {
          throw new Error("missing");
        },
      } as never,
      dependencies: {
        container,
        cache: undefined as never,
        policyGate: gate,
        queue: undefined as never,
      } as never,
    });

    const handler = securedBindRouteModelByKey(
      "slug",
      async () => null,
      { resource: "forum", action: "view" },
      async () => Response.json({ ok: true }),
    );
    const request = new Request("http://localhost/forum/general/missing") as Request & {
      params: { slug: string };
    };
    request.params = { slug: "missing" };

    await expect(runWithAuthUser(null, () => handler(request))).rejects.toThrow(NotFoundError);
  });

  test("does not ETag HTML document responses by default", async () => {
    const gate = new PolicyGate();
    gate.register("forum", new PublicForumPolicy());

    const container = new ServiceContainer();
    container.set(CORE_POLICY_GATE_TOKEN, gate);
    container.set(CORE_AUTH_TOKEN, {
      resolve: async () => null,
    });

    setActiveApplicationContext({
      container,
      config: {
        get: <T>() => undefined as T,
        set: <T>(_key: string, value: T) => value,
        has: () => false,
        require: () => {
          throw new Error("missing");
        },
      } as never,
      dependencies: {
        container,
        cache: undefined as never,
        policyGate: gate,
        queue: undefined as never,
      } as never,
    });

    const handler = securedBindRouteModelByKey(
      "slug",
      async (slug) => ({ category: "general", slug }),
      { resource: "forum", action: "view" },
      async (_request, model) =>
        new Response(`<html>${model.slug}</html>`, {
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
    );
    const request = new Request("http://localhost/forum/general/welcome") as Request & {
      params: { slug: string };
    };
    request.params = { slug: "welcome" };

    const response = await runWithAuthUser(null, () => handler(request));
    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toBeNull();
  });
});
