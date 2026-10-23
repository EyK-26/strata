import { afterEach, describe, expect, test } from "bun:test";
import { CORE_AUTH_TOKEN, CORE_POLICY_GATE_TOKEN } from "@getstrata/bootstrap/config";
import { ServiceContainer } from "@getstrata/bootstrap/contracts";
import {
  routeParams,
  toRouteRequest,
  wrapSecuredRouteModelByKey,
} from "@getstrata/bootstrap/web/routing";
import { Policy, PolicyGate } from "@getstrata/core/auth/policy";
import { setActiveApplicationContext } from "@getstrata/core/runtime/applicationRegistry";
import { restoreEnvVar } from "../helpers/restoreEnv";

class PublicForumPolicy extends Policy {
  override view() {
    return true;
  }
}

describe("bootstrap web routing", () => {
  const previousFrontendMode = process.env.FRONTEND_MODE;

  afterEach(() => {
    if (previousFrontendMode === undefined) {
      delete process.env.FRONTEND_MODE;
    } else {
      restoreEnvVar("FRONTEND_MODE", previousFrontendMode);
    }
  });

  test("wrapSecuredRouteModelByKey resolves Bun native route params", async () => {
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

    const server = Bun.serve({
      port: 0,
      routes: {
        "/forum/:category/:slug": wrapSecuredRouteModelByKey(
          "slug",
          async (slug, request) => ({
            category: request.params.category,
            slug,
          }),
          { resource: "forum", action: "view" },
          async (_request, model) => Response.json(model),
        ),
      },
    });

    try {
      const response = await fetch(`http://localhost:${server.port}/forum/general/welcome`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ category: "general", slug: "welcome" });

      for (const [encoded, slug] of [
        ["caf%C3%A9", "café"],
        ["100%25", "100%"],
        ["%252F", "%2F"],
        ["a%2Fb", "a/b"],
        ["%2525", "%25"],
        ["%25E0%25A4%25A", "%E0%A4%A"],
      ]) {
        const encodedResponse = await fetch(
          `http://localhost:${server.port}/forum/general/${encoded}`,
        );
        expect(encodedResponse.status).toBe(200);
        expect(await encodedResponse.json()).toEqual({ category: "general", slug });
      }
    } finally {
      await server.stop(true);
    }
  });

  test("wrapSecuredRouteModelByKey returns a styled HTML 404 for a missing slug", async () => {
    process.env.FRONTEND_MODE = "server-htmx";
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

    const server = Bun.serve({
      port: 0,
      routes: {
        "/forum/:category/:slug": wrapSecuredRouteModelByKey(
          "slug",
          async () => null,
          { resource: "forum", action: "view" },
          async () => new Response("<html>ok</html>"),
        ),
      },
    });

    const response = await fetch(`http://localhost:${server.port}/forum/nope/nope`, {
      headers: { accept: "text/html" },
    });
    const html = await response.text();

    expect(response.status).toBe(404);
    expect(html).toContain("<!doctype html>");
    expect(html).toContain('href="/assets/app.css"');
    expect(html).toContain("Not Found");
    expect(response.headers.get("etag")).toBeNull();

    server.stop(true);
  });

  test("toRouteRequest normalizes params on the native request", async () => {
    const server = Bun.serve({
      port: 0,
      routes: {
        "/items/:id": (request) => {
          const routeRequest = toRouteRequest<{ id: string }>(request);
          return Response.json(routeRequest.params);
        },
      },
    });

    const response = await fetch(`http://localhost:${server.port}/items/42`);
    expect(await response.json()).toEqual({ id: "42" });

    server.stop(true);
  });

  test("route adaptation preserves Bun's decoded values and is safe to repeat", async () => {
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      routes: {
        "/items/:id": (request) => {
          const native = { ...request.params };
          const copied = routeParams(request);
          expect(request.params).toEqual(native);
          const first = toRouteRequest<{ id: string }>(request);
          expect(first).toBe(request);
          const firstParams = { ...first.params };
          const second = toRouteRequest<{ id: string }>(request);
          expect(second).toBe(request);
          return Response.json({ native, copied, first: firstParams, second: second.params });
        },
      },
    });
    try {
      for (const [encoded, id] of [
        ["42", "42"],
        ["caf%C3%A9", "café"],
        ["100%25", "100%"],
        ["%252F", "%2F"],
        ["a%2Fb", "a/b"],
        ["%2525", "%25"],
        ["%25E0%25A4%25A", "%E0%A4%A"],
      ]) {
        const response = await fetch(new URL(`/items/${encoded}`, server.url));
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
          native: { id },
          copied: { id },
          first: { id },
          second: { id },
        });
      }
    } finally {
      await server.stop(true);
    }
  });
});
