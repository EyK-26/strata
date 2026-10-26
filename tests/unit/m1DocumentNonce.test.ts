import { expect, test } from "bun:test";
import { collectProviders } from "@getstrata/bootstrap/context";
import { currentRequestMeta } from "@getstrata/core/http/requestMetaContext";
import { htmlResponse } from "@getstrata/core/view";
import { startGuardedApplication } from "../../src/bootstrap/m1/application";

test("M1 raw document handler receives the nonce installed in its response CSP", async () => {
  const app = await startGuardedApplication({
    providers: collectProviders([]).filter((provider) =>
      ["core.config", "core.cache", "core.storage", "core.auth", "core.policy"].includes(
        provider.name,
      ),
    ),
    documents: {
      render: async () => htmlResponse("unused"),
      renderHtmx: async () => htmlResponse("unused"),
    },
    modules: [
      {
        name: "nonce",
        webRoutes: () => ({
          "/nonce": () =>
            htmlResponse(`<script nonce="${currentRequestMeta().cspNonce}">void 0</script>`),
        }),
      },
    ],
  });
  try {
    const response = await fetch(new URL("/nonce", app.server.url));
    const nonce = /'nonce-([^']+)'/.exec(
      response.headers.get("content-security-policy") ?? "",
    )?.[1];
    expect(nonce).toBeDefined();
    expect(await response.text()).toBe(`<script nonce="${nonce}">void 0</script>`);
  } finally {
    expect((await app.shutdown()).successful).toBe(true);
  }
});
