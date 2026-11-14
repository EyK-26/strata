import { expect, test } from "bun:test";
import {
  InMemorySamlAssertionReplayStore,
  SamlServiceProvider,
} from "@getstrata/core/auth/saml/samlServiceProvider";
import { privateJsonResponse } from "@getstrata/core/http/response";
import * as stateHelpers from "@getstrata/core/security/oauthState";
import { renderApiAuthRoutes } from "../../../packages/strata-starter/src/auth/renderApiRoutes.ts";
import { createAuthRenderingContext } from "../../../packages/strata-starter/src/auth/renderingContext.ts";
import { compileStarterFeatures } from "../../../packages/strata-starter/src/featurePlan.ts";
import {
  layersFromFlags,
  parseCreateStrataArgs,
} from "../../../packages/strata-starter/src/parseArgs.ts";
import { createSignedSamlResponse } from "../../helpers/samlFixture.ts";

test("generated SAML ACS binds a fresh signed assertion to the initiating browser", async () => {
  const assertion = await createSignedSamlResponse({ email: "attacker@example.test" });
  const provider = new SamlServiceProvider({
    idpSsoUrl: "https://idp.example.test/login",
    idpCert: assertion.cert,
    idpIssuer: "https://idp.example.test/metadata",
    spEntityId: "https://sp.example.test/metadata",
    acsUrl: "https://app.example.test/auth/saml/acs",
    replayStore: new InMemorySamlAssertionReplayStore(),
  });
  const source = renderApiAuthRoutes(
    createAuthRenderingContext(
      compileStarterFeatures(
        layersFromFlags(parseCreateStrataArgs(["--auth=cookie", "--oauth-github"])),
      ),
    ),
  );
  const start = source.indexOf('"/auth/saml":');
  const end = source.indexOf('"/auth/github":', start);
  if (start < 0 || end < 0) throw new Error("Generated SAML route boundaries are missing.");
  const javascript = new Bun.Transpiler({ loader: "ts" }).transformSync(
    `function getRoutes() { return { ${source.slice(start, end)} }; }`,
  );
  let consumes = 0;
  const routes = new Function(
    "kernel",
    "authServices",
    "createSamlStateCookie",
    "verifySamlState",
    "clearSamlStateCookie",
    "privateJsonResponse",
    "completeBrowserSsoLogin",
    `${javascript}\nreturn getRoutes();`,
  )(
    {
      wrap: (_name: string, handler: unknown) => handler,
      wrapIdentity: (handler: unknown) => handler,
    },
    {
      config: {
        samlEnabled: true,
        oauth: { secret: "generated-saml-browser-state-secret", production: true },
      },
      saml: () => ({
        authorizationUrl: (state: string) => provider.authorizationUrl(state),
        consumePost: (...args: Parameters<SamlServiceProvider["consumePost"]>) => {
          consumes++;
          return provider.consumePost(...args);
        },
      }),
    },
    stateHelpers.createSamlStateCookie,
    stateHelpers.verifySamlState,
    stateHelpers.clearSamlStateCookie,
    privateJsonResponse,
    async (_ports: unknown, _services: unknown, profile: { email: string }) =>
      new Response(`signed in ${profile.email}`),
  ) as {
    "/auth/saml": { GET: (request: Request, ports: object) => Promise<Response> };
    "/auth/saml/acs": { POST: (request: Request, ports: object) => Promise<Response> };
  };
  const initiate = () =>
    routes["/auth/saml"].GET(new Request("https://app.example.test/auth/saml"), {});
  const attackerStart = await initiate();
  const otherStart = await initiate();
  const state = new URL(attackerStart.headers.get("location") ?? "").searchParams.get("RelayState");
  const post = (cookie: string) =>
    routes["/auth/saml/acs"].POST(
      new Request("https://app.example.test/auth/saml/acs", {
        method: "POST",
        headers: { origin: "https://idp.example.test", cookie },
        body: new URLSearchParams({ SAMLResponse: assertion.responseB64, RelayState: state ?? "" }),
      }),
      {},
    );

  for (const cookie of ["", otherStart.headers.get("set-cookie")?.split(";")[0] ?? ""]) {
    const denied = await post(cookie);
    expect(denied.status).toBe(403);
    expect(consumes).toBe(0);
    expect(denied.headers.get("set-cookie")).toContain("Max-Age=0");
  }
  const cookie = attackerStart.headers.get("set-cookie") ?? "";
  expect(cookie).toContain("saml_state=");
  expect(cookie).toContain("HttpOnly; SameSite=None; Max-Age=600; Secure");
  const accepted = await post(cookie.split(";")[0] ?? "");
  expect(accepted.status).toBe(200);
  expect(await accepted.text()).toBe("signed in attacker@example.test");
  expect(accepted.headers.get("set-cookie")).toContain("Max-Age=0");
  const replay = await post(cookie.split(";")[0] ?? "");
  expect(replay.status).toBe(400);
  expect(await replay.json()).toEqual({ error: "Invalid SAML response." });
  expect(consumes).toBe(2);
});
