import { expect, test } from "bun:test";
import { GitHubOAuthProvider } from "@getstrata/core/auth/oauth/providers";
import { privateJsonResponse } from "@getstrata/core/http/response";
import {
  clearOAuthStateCookie,
  createOAuthState,
  createOAuthStateCookie,
  verifyOAuthState,
} from "@getstrata/core/security/oauthState";
import { renderApiAuthRoutes } from "../../../packages/strata-starter/src/auth/renderApiRoutes.ts";
import { createAuthRenderingContext } from "../../../packages/strata-starter/src/auth/renderingContext.ts";
import { compileStarterFeatures } from "../../../packages/strata-starter/src/featurePlan.ts";
import {
  layersFromFlags,
  parseCreateStrataArgs,
} from "../../../packages/strata-starter/src/parseArgs.ts";

function githubRoutes(exchange: () => Promise<unknown>) {
  const plan = compileStarterFeatures(
    layersFromFlags(
      parseCreateStrataArgs(["--auth=cookie", "--oauth-github", "--oidc", "--database=sqlite"]),
    ),
  );
  const source = renderApiAuthRoutes(createAuthRenderingContext(plan));
  const start = source.indexOf('"/auth/github":');
  const end = source.indexOf('"/auth/oidc":', start);
  if (start < 0 || end < 0) throw new Error("Generated GitHub route boundaries are missing.");
  const javascript = new Bun.Transpiler({ loader: "ts" }).transformSync(
    `function getRoutes() { return { ${source.slice(start, end)} }; }`,
  );
  const oauth = { secret: "generated-github-state-regression-secret", production: true };
  const routes = new Function(
    "kernel",
    "authServices",
    "GitHubOAuthProvider",
    "createOAuthState",
    "createOAuthStateCookie",
    "clearOAuthStateCookie",
    "verifyOAuthState",
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
        oauthEnabled: true,
        oauth,
        github: {
          clientId: "client-id",
          clientSecret: "client-secret",
          redirectUri: "https://app.example.test/auth/github/callback",
          production: true,
          userAgent: "regression-test",
        },
      },
    },
    class extends GitHubOAuthProvider {
      override async exchangeCode() {
        return (await exchange()) as Awaited<ReturnType<GitHubOAuthProvider["exchangeCode"]>>;
      }
    },
    createOAuthState,
    createOAuthStateCookie,
    clearOAuthStateCookie,
    verifyOAuthState,
    privateJsonResponse,
    async () => new Response("signed in", { status: 200 }),
  ) as Record<
    "/auth/github" | "/auth/github/callback",
    { GET: (request: Request, ports: object) => Promise<Response> }
  >;
  return { routes, oauth };
}

test("generated GitHub callback rejects an attacker's valid state before exchanging their code", async () => {
  let exchanges = 0;
  const { routes, oauth } = githubRoutes(async () => {
    exchanges++;
    return { providerUserId: "attacker", email: "attacker@example.test", name: "Attacker" };
  });
  const attacker = createOAuthStateCookie(oauth);
  const otherBrowser = createOAuthStateCookie(oauth);
  for (const cookie of ["", otherBrowser.cookie.split(";")[0] ?? ""]) {
    const response = await routes["/auth/github/callback"].GET(
      new Request(
        `https://app.example.test/auth/github/callback?code=attacker-code&state=${attacker.state}`,
        { headers: { cookie } },
      ),
      {},
    );
    expect(response.status).toBe(403);
    expect(exchanges).toBe(0);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  }
});

test("generated GitHub initiation binds a cookie and clears it after the callback", async () => {
  for (const succeeds of [true, false]) {
    let exchanges = 0;
    const { routes } = githubRoutes(async () => {
      exchanges++;
      if (!succeeds) throw new Error("Provider rejected code");
      return { providerUserId: "member", email: "member@example.test", name: "Member" };
    });
    const start = await routes["/auth/github"].GET(
      new Request("https://app.example.test/auth/github"),
      {},
    );
    expect(start.status).toBe(302);
    const state = new URL(start.headers.get("location") ?? "").searchParams.get("state");
    const cookie = start.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("HttpOnly; SameSite=Lax; Max-Age=600; Secure");
    const callback = await routes["/auth/github/callback"].GET(
      new Request(`https://app.example.test/auth/github/callback?code=member-code&state=${state}`, {
        headers: { cookie: cookie.split(";")[0] ?? "" },
      }),
      {},
    );
    expect(exchanges).toBe(1);
    expect(callback.status).toBe(succeeds ? 200 : 400);
    expect(callback.headers.get("set-cookie")).toContain("Max-Age=0");
  }
});
