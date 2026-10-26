import { expect, test } from "bun:test";
import { collectProviders } from "@getstrata/bootstrap/context";
import { resolveCsrfTokenForRequest } from "@getstrata/core/http/csrfToken";
import { startGuardedApplication } from "../../src/bootstrap/m1/application";

for (const frontend of ["api", "server-htmx"]) {
  test(`M1 documents own CSRF even when the frontend label is ${frontend}`, async () => {
    const previous = {
      FRONTEND_MODE: process.env.FRONTEND_MODE,
      CSRF_TARGET_ORIGIN: process.env.CSRF_TARGET_ORIGIN,
    };
    process.env.FRONTEND_MODE = frontend;
    if (frontend === "server-htmx") process.env.CSRF_TARGET_ORIGIN = "https://forms.example.test";
    else delete process.env.CSRF_TARGET_ORIGIN;
    let posts = 0;
    const app = await startGuardedApplication({
      providers: collectProviders([]).filter((provider) =>
        ["core.config", "core.cache", "core.storage", "core.auth", "core.policy"].includes(
          provider.name,
        ),
      ),
      documents: {
        render: async () => new Response("unused"),
        renderHtmx: async () => new Response("unused"),
      },
      modules: [
        {
          name: "form",
          webRoutes: () => ({
            "/form": {
              GET: (request) => new Response(resolveCsrfTokenForRequest(request)),
              POST: async (request) => {
                posts++;
                return new Response(String((await request.formData()).get("message")));
              },
            },
          }),
        },
      ],
    });
    try {
      const url = new URL("/form", app.server.url);
      const origin = frontend === "api" ? app.server.url.origin : "https://forms.example.test";
      const admission: Record<string, string> =
        frontend === "api" ? {} : { Host: "forms.example.test" };
      const submit = (headers: Record<string, string>, token?: string) =>
        fetch(url, {
          method: "POST",
          headers: { ...admission, Origin: origin, ...headers },
          body: new URLSearchParams({
            message: "Příliš žluťoučký",
            ...(token ? { _token: token } : {}),
          }),
        });
      expect((await submit({})).status).toBe(403);
      expect(posts).toBe(0);
      const get = await fetch(url, { headers: admission });
      expect(get.status).toBe(200);
      const token = await get.text();
      const cookie = get.headers.getSetCookie().find((value) => value.startsWith("strata_csrf="));
      expect(cookie).toBeDefined();
      const Cookie = cookie?.split(";")[0] ?? "";
      expect((await submit({ Cookie }, "invalid")).status).toBe(403);
      expect((await submit({ Cookie, Origin: "https://evil.example.test" }, token)).status).toBe(
        403,
      );
      expect(
        (
          await submit(
            {
              Cookie,
              Origin: "https://evil.example.test",
              "X-Forwarded-Host": new URL(origin).host,
              "X-Forwarded-Proto": "https",
            },
            token,
          )
        ).status,
      ).toBe(403);
      const accepted = await submit({ Cookie }, token);
      expect(accepted.status).toBe(200);
      expect(await accepted.text()).toBe("Příliš žluťoučký");
      expect(posts).toBe(1);
      if (frontend === "server-htmx") {
        expect((await fetch(url)).status).toBe(403);
        expect((await submit({ Cookie, Host: "evil.example.test" }, token)).status).toBe(403);
        expect(posts).toBe(1);
      }
    } finally {
      expect((await app.shutdown()).successful).toBe(true);
      for (const [name, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });
}
