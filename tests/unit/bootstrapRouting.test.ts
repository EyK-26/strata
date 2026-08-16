import { describe, expect, test } from "bun:test";
import { CORE_AUTH_TOKEN, CORE_POLICY_GATE_TOKEN } from "@getstrata/bootstrap/config";
import { ServiceContainer } from "@getstrata/bootstrap/contracts";
import { toRouteRequest, wrapSecuredRouteModelByKey } from "@getstrata/bootstrap/web/routing";
import { Policy, PolicyGate } from "@getstrata/core";
import { setActiveApplicationContext } from "@getstrata/core/runtime/applicationRegistry";

class PublicForumPolicy extends Policy {
  override view() {
    return true;
  }
}

describe("bootstrap web routing", () => {
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

    const response = await fetch(`http://localhost:${server.port}/forum/general/welcome`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ category: "general", slug: "welcome" });

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
});
