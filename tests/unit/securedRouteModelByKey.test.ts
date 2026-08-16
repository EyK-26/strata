import { describe, expect, test } from "bun:test";
import { CORE_AUTH_TOKEN, CORE_POLICY_GATE_TOKEN } from "@getstrata/bootstrap/config";
import { ServiceContainer } from "@getstrata/bootstrap/contracts";
import { Policy, PolicyGate } from "@getstrata/core/auth/policy";
import { securedBindRouteModelByKey } from "@getstrata/core/http/securedRouteModelBinding";
import { setActiveApplicationContext } from "@getstrata/core/runtime/applicationRegistry";
import { runWithAuthUser } from "../../src/core/auth/authContext";

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
  });
});
