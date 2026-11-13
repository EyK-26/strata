import { describe, expect, test } from "bun:test";
import { Policy, PolicyGate } from "@getstrata/core/auth/policy";
import { NotFoundError } from "@getstrata/core/errors/http";
import { securedBindRouteModelByKey } from "@getstrata/core/http/securedRouteModelBinding";

class PublicForumPolicy extends Policy {
  override view() {
    return true;
  }
}

describe("securedBindRouteModelByKey", () => {
  test("resolves string route keys and authorizes before handling", async () => {
    const gate = new PolicyGate();
    gate.register("forum", new PublicForumPolicy());

    const ports = {
      auth: { resolve: async () => null },
      authorize: gate.authorize.bind(gate),
      etagEnabled: true,
    };

    const handler = securedBindRouteModelByKey(
      "slug",
      async (slug) => ({ slug }),
      { resource: "forum", action: "view" },
      async (_request, model) => Response.json(model),
      ports,
    );

    const request = new Request("http://localhost/forum/general/welcome") as Request & {
      params: { slug: string };
    };
    request.params = { slug: "welcome" };

    const response = await handler(request);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ slug: "welcome" });
    expect(response.headers.get("etag")).toBeNull();
  });

  test("throws NotFoundError when the resolver returns null", async () => {
    const gate = new PolicyGate();
    gate.register("forum", new PublicForumPolicy());

    const ports = {
      auth: { resolve: async () => null },
      authorize: gate.authorize.bind(gate),
      etagEnabled: true,
    };

    const handler = securedBindRouteModelByKey(
      "slug",
      async () => null,
      { resource: "forum", action: "view" },
      async () => Response.json({ ok: true }),
      ports,
    );
    const request = new Request("http://localhost/forum/general/missing") as Request & {
      params: { slug: string };
    };
    request.params = { slug: "missing" };

    await expect(handler(request)).rejects.toThrow(NotFoundError);
  });

  test("does not ETag HTML document responses by default", async () => {
    const gate = new PolicyGate();
    gate.register("forum", new PublicForumPolicy());

    const ports = {
      auth: { resolve: async () => null },
      authorize: gate.authorize.bind(gate),
      etagEnabled: true,
    };

    const handler = securedBindRouteModelByKey(
      "slug",
      async (slug) => ({ category: "general", slug }),
      { resource: "forum", action: "view" },
      async (_request, model) =>
        new Response(`<html>${model.slug}</html>`, {
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
      ports,
    );
    const request = new Request("http://localhost/forum/general/welcome") as Request & {
      params: { slug: string };
    };
    request.params = { slug: "welcome" };

    const response = await handler(request);
    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toBeNull();
  });
});
