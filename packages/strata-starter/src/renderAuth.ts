import {
  authNeedsUsers,
  authUsesCookie,
  authUsesJwt,
  authUsesToken,
  isHiringRecipe,
  type StarterLayers,
} from "./types.ts";

function renderAuthDirectory(layers: StarterLayers): string | null {
  if (!authNeedsUsers(layers.auth)) {
    return null;
  }

  const tokenLookup = authUsesToken(layers.auth)
    ? `
  async resolveUserFromToken(token: string) {
    if (!token || token.split(".").length === 3) {
      return null;
    }
    const hashed = hashApiToken(token);
    const rows = await getSql().unsafe<
      Array<{
        id: number;
        user_id: number;
        abilities: string;
        expires_at: Date | string | null;
        role?: string;
        is_admin?: number | boolean;
        email_verified_at?: Date | string | null;
      }>
    >(
      \`SELECT t.id, t.user_id, t.abilities, t.expires_at, u.is_admin, u.email_verified_at
       FROM api_tokens t INNER JOIN users u ON u.id = t.user_id
       WHERE t.token_hash = ?\`,
      [hashed],
    );
    const row = rows[0];
    if (!row) {
      return null;
    }
    if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) {
      return null;
    }
    let abilities: string[] = [];
    try {
      abilities = JSON.parse(String(row.abilities ?? "[]")) as string[];
    } catch {
      abilities = ["profile:read"];
    }
    return {
      id: Number(row.user_id),
      role: row.is_admin ? "admin" : "member",
      abilities,
      tokenId: Number(row.id),
      emailVerifiedAt: row.email_verified_at ?? null,
    };
  },`
    : `
  async resolveUserFromToken() {
    return null;
  },`;

  const placeholder = layers.database === "postgres" ? "$1" : "?";

  return `import { verifyPassword } from "@getstrata/core/auth/password";
import { hashApiToken } from "@getstrata/core/auth/tokenHash";
import type { AuthUser } from "@getstrata/core/auth/authContext";
import type { AuthUserDirectory } from "@getstrata/core/contracts/authUserDirectory";
import { getSql } from "./database.ts";

function mapRole(isAdmin: unknown): string {
  return isAdmin === true || isAdmin === 1 || isAdmin === "1" ? "admin" : "member";
}

export const starterAuthDirectory: AuthUserDirectory = {
${tokenLookup.replace("WHERE t.token_hash = ?", `WHERE t.token_hash = ${placeholder}`)}

  async findByIdOrThrow(id: number) {
    const rows = await getSql().unsafe<
      Array<{
        id: number;
        email: string;
        is_admin: number | boolean;
        email_verified_at: Date | string | null;
        password: string;
      }>
    >(\`SELECT id, email, is_admin, email_verified_at, password FROM users WHERE id = ${placeholder}\`, [id]);
    const row = rows[0];
    if (!row) {
      throw new Error(\`User \${id} not found.\`);
    }
    return {
      id: Number(row.id),
      email: row.email,
      role: mapRole(row.is_admin),
      email_verified_at: row.email_verified_at ?? null,
      password: row.password,
    };
  },

  async findByEmail(email: string) {
    const rows = await getSql().unsafe<
      Array<{
        id: number;
        email: string;
        is_admin: number | boolean;
        email_verified_at: Date | string | null;
        password: string;
      }>
    >(
      \`SELECT id, email, is_admin, email_verified_at, password FROM users WHERE email = ${placeholder}\`,
      [email.trim().toLowerCase()],
    );
    const row = rows[0];
    if (!row) {
      return null;
    }
    return {
      id: Number(row.id),
      email: row.email,
      role: mapRole(row.is_admin),
      email_verified_at: row.email_verified_at ?? null,
      password: row.password,
    };
  },

  async verifyCredentials(email: string, password: string): Promise<AuthUser | null> {
    const user = await this.findByEmail(email);
    if (!user?.password || !(await verifyPassword(password, user.password))) {
      return null;
    }
    return {
      id: user.id,
      role: user.role,
      emailVerifiedAt: user.email_verified_at ?? null,
    };
  },
};
`;
}

function renderAuthProvider(layers: StarterLayers): string {
  if (layers.auth === "headers") {
    return `import { CORE_AUTH_TOKEN } from "@getstrata/bootstrap/config";
import type { AuthUser } from "@getstrata/core/auth/authContext";
import { currentAuthUser } from "@getstrata/core/auth/authContext";
import type { ServiceProvider } from "@getstrata/core/contracts/di";

class StarterAuthManager {
  async resolve(request?: Request): Promise<AuthUser | null> {
    if (process.env.AUTH_DEV_HEADERS === "false") {
      return request ? null : currentAuthUser();
    }
    if (request) {
      const userId = request.headers.get("x-authenticated-user-id");
      if (!userId) {
        return null;
      }
      const role = request.headers.get("x-authenticated-user-role");
      return {
        id: userId,
        ...(role ? { role } : {}),
      };
    }
    return currentAuthUser();
  }

  user(request?: Request) {
    return this.resolve(request);
  }

  async check(request: Request) {
    return (await this.user(request)) !== null;
  }
}

const authProvider: ServiceProvider = {
  name: "starter.auth",
  register({ container }) {
    container.set(CORE_AUTH_TOKEN, new StarterAuthManager());
  },
};

export default authProvider;
`;
  }

  const cookieBlock = authUsesCookie(layers.auth)
    ? `    const auth = createCookieSessionAuthManager({
      secret: process.env.SESSION_SECRET?.trim() || "dev-session-secret-change-me-please-32ch",
      cookieName: "strata_session",
      mapUser: (user) => ({
        id: user.id,
        role: user.is_admin ? "admin" : "member",
      }),
    });`
    : `    const fallback = ${
        authUsesToken(layers.auth) ? "new DatabaseTokenGuard(container)" : "new JwtGuard()"
      };
    const auth = new AuthManager(fallback);`;

  const tokenRegs = authUsesToken(layers.auth)
    ? `    const apiGuard = new DatabaseTokenGuard(container);
    auth.registerGuard("api", apiGuard);
    auth.registerGuard("access_token", apiGuard);
    auth.registerGuard("token", apiGuard);`
    : "";

  const jwtReg = authUsesJwt(layers.auth) ? `    auth.registerGuard("jwt", new JwtGuard());` : "";

  const basicReg =
    layers.kit === "enterprise" || layers.kit === "hiroapp-enterprise"
      ? `    auth.registerGuard("basic", new BasicAuthGuard(container));`
      : "";

  const ability = authUsesToken(layers.auth)
    ? `    container.set(CORE_ABILITY_CHECKER_TOKEN, createTokenAbilityChecker());`
    : "";

  return `import { CORE_AUTH_TOKEN } from "@getstrata/bootstrap/config";
import { createCookieSessionAuthManager } from "@getstrata/bootstrap/web/session";
import { BasicAuthGuard } from "@getstrata/core/auth/basicAuthGuard";
import { AuthManager, DatabaseTokenGuard } from "@getstrata/core/auth/guard";
import { JwtGuard } from "@getstrata/core/auth/jwtGuard";
import { createTokenAbilityChecker } from "@getstrata/core/auth/tokenAbilityChecker";
import type { ServiceProvider } from "@getstrata/core/contracts/di";
import {
  CORE_ABILITY_CHECKER_TOKEN,
  CORE_AUTH_USER_DIRECTORY_TOKEN,
} from "@getstrata/core/contracts/serviceTokens";
import { starterAuthDirectory } from "../authDirectory.ts";

const authProvider: ServiceProvider = {
  name: "starter.auth",
  register({ container }) {
    container.set(CORE_AUTH_USER_DIRECTORY_TOKEN, starterAuthDirectory);
${cookieBlock}
${tokenRegs}
${jwtReg}
${basicReg}
${ability}
    container.set(CORE_AUTH_TOKEN, auth);
  },
};

export default authProvider;
`;
}

function renderAuthModule(layers: StarterLayers): string | null {
  if (!authNeedsUsers(layers.auth)) {
    return null;
  }

  const cookieRoutes = authUsesCookie(layers.auth)
    ? `
    webRoutes({ kernel, dependencies }) {
      const auth = dependencies.container.resolve<CookieSessionAuthManager>(CORE_AUTH_TOKEN);
      return {
        "/login": {
          GET: kernel.wrapWebGuest(async (request) =>
            renderPage(
              "auth/login.eta",
              { layout: { title: "Sign in" }, errors: {}, email: "" },
              request,
            ),
          ),
          POST: wrapWebLogin(
            kernel,
            async (request) => {
              const { fields } = await parseFormBody(request);
              const email = (fields.email ?? "").trim().toLowerCase();
              const password = fields.password ?? "";
              const user = await starterAuthDirectory.findByEmail?.(email);
              if (!user?.password || !(await verifyPassword(password, user.password))) {
                return renderPage(
                  "auth/login.eta",
                  {
                    layout: { title: "Sign in" },
                    errors: { email: "These credentials do not match our records." },
                    email,
                  },
                  request,
                );
              }
              return auth.signInRedirect(
                {
                  id: user.id,
                  name: user.email ?? "",
                  email: user.email ?? "",
                  is_admin: user.role === "admin",
                },
                "/",
              );
            },
            async () => new Response("Too many login attempts", { status: 429 }),
          ),
        },
        "/logout": {
          POST: kernel.wrapWebAuthenticatedAllowUnverified((request) =>
            auth.signOutRedirect(request, "/login"),
          ),
        },
      };
    },`
    : "";

  const apiLogin = authUsesToken(layers.auth)
    ? `
        "/api/v1/auth/login": {
          POST: kernel.wrap("api", withErrorHandling(async (request) => {
            const body = (await request.json()) as { email?: string; password?: string };
            const email = (body.email ?? "").trim().toLowerCase();
            const password = body.password ?? "";
            const user = await starterAuthDirectory.verifyCredentials?.(email, password);
            if (!user) {
              return jsonResponse({ error: "Invalid credentials" }, { status: 422 });
            }
            const plain = \`strp_\${randomBytes(24).toString("hex")}\`;
            await getSql().unsafe(
              "INSERT INTO api_tokens (user_id, name, token_hash, abilities) VALUES (${layers.database === "postgres" ? "$1, $2, $3, $4" : "?, ?, ?, ?"})",
              [user.id, "spa", hashApiToken(plain), JSON.stringify(["profile:read"])],
            );
            return jsonResponse({ token: plain });
          })),
        },
        "/api/v1/auth/me": {
          GET: kernel.wrapApi(async (request) => {
            const user = await dependencies.container.resolve<AuthManager>(CORE_AUTH_TOKEN).requireUser(request);
            const record = await starterAuthDirectory.findByIdOrThrow(Number(user.id));
            return jsonResponse({
              id: record.id,
              name: record.email,
              email: record.email,
              role: record.role,
            });
          }),
        },`
    : "";

  const jwtLogin = authUsesJwt(layers.auth)
    ? `
        "/api/auth/token": {
          POST: kernel.wrap("api", withErrorHandling(async (request) => {
            const body = (await request.json()) as { email?: string; password?: string };
            const email = (body.email ?? "").trim().toLowerCase();
            const password = body.password ?? "";
            const user = await starterAuthDirectory.verifyCredentials?.(email, password);
            if (!user) {
              return jsonResponse({ error: "Invalid credentials" }, { status: 422 });
            }
            const token = signJwt({
              sub: user.id,
              role: user.role,
              abilities: user.role === "admin" ? ["profile:read", "reports:export"] : ["profile:read"],
            });
            return jsonResponse({
              token,
              token_type: "bearer",
              expires_in: jwtTtlSeconds(),
            });
          })),
        },`
    : "";

  const apiUser =
    authUsesToken(layers.auth) || authUsesJwt(layers.auth)
      ? `
        "/api/user": {
          GET: kernel.wrapApi(async (request) => {
            const user = await dependencies.container.resolve<AuthManager>(CORE_AUTH_TOKEN).requireUser(request);
            return jsonResponse({ id: user.id, role: user.role ?? "member" });
          }),
        },`
      : "";

  const routesBlock =
    apiLogin || jwtLogin || apiUser
      ? `
    routes({ kernel, dependencies }) {
      return {${apiLogin}${jwtLogin}${apiUser}
      };
    },`
      : "";

  return `import { randomBytes } from "node:crypto";
import type { AppModule } from "@getstrata/bootstrap/contracts";
import { CORE_AUTH_TOKEN } from "@getstrata/bootstrap/config";
import { parseFormBody } from "@getstrata/bootstrap/web/forms";
import { wrapWebLogin } from "@getstrata/bootstrap/web/routing";
import type { CookieSessionAuthManager } from "@getstrata/bootstrap/web/session";
import { jwtTtlSeconds, signJwt } from "@getstrata/core/auth/jwt";
import { AuthManager } from "@getstrata/core/auth/guard";
import { verifyPassword } from "@getstrata/core/auth/password";
import { hashApiToken } from "@getstrata/core/auth/tokenHash";
import { jsonResponse, withErrorHandling } from "@getstrata/core/http/response";
import { starterAuthDirectory } from "../../bootstrap/authDirectory.ts";
import { getSql } from "../../bootstrap/database.ts";
import { renderPage } from "../../lib/view.ts";

const authModule: AppModule = {
  name: "auth",
  order: 2,${routesBlock}${cookieRoutes}
};

export default authModule;
`;
}

function renderSiteModule(layers: StarterLayers): string {
  const loginHint =
    authUsesCookie(layers.auth) &&
    (layers.frontend === "server-htmx" || layers.frontend === "hybrid")
      ? " Sign in at /login."
      : "";

  return `import type { AppModule } from "@getstrata/bootstrap/contracts";
import { withErrorHandling } from "@getstrata/core/http/response";
import { pingDatabase } from "../../bootstrap/database.ts";
import { plainText, renderPage } from "../../lib/view.ts";

const siteModule: AppModule = {
  name: "site",
  order: 1,
  routes({ kernel }) {
    return {
      "/health": kernel.wrap("api", withErrorHandling(async () => {
        const dbOk = await pingDatabase();
        return plainText(dbOk ? "ok" : "degraded");
      })),
    };
  },
  webRoutes({ kernel }) {
    return {
      "/": kernel.wrapWeb(async (request) =>
        renderPage(
          "home.eta",
          {
            layout: {
              title: "Home",
              description: "A new Strata application.${loginHint}",
            },
          },
          request,
        ),
      ),
    };
  },
};

export default siteModule;
`;
}

function renderCareersModule(layers: StarterLayers): string | null {
  if (!isHiringRecipe(layers.kit)) {
    return null;
  }

  return `import type { AppModule } from "@getstrata/bootstrap/contracts";
import { renderPage } from "../../lib/view.ts";

const careersModule: AppModule = {
  name: "careers",
  order: 3,
  webRoutes({ kernel }) {
    return {
      "/careers": kernel.wrapWeb(async (request) =>
        renderPage(
          "careers.eta",
          {
            layout: {
              title: "Careers",
              description: "Open roles",
            },
          },
          request,
        ),
      ),
    };
  },
};

export default careersModule;
`;
}

function renderLoginView(): string {
  return `<section class="section">
  <h1>Sign in</h1>
  <p>Seeded accounts use password <code>password</code>.</p>
  <% if (it.errors && it.errors.email) { %>
  <p class="error"><%= it.errors.email %></p>
  <% } %>
  <form method="post" action="/login">
    <input type="hidden" name="_token" value="<%= it.csrfToken %>" />
    <label>
      Email
      <input type="email" name="email" value="<%= it.email || "demo@example.com" %>" required />
    </label>
    <label>
      Password
      <input type="password" name="password" value="password" required />
    </label>
    <button type="submit">Sign in</button>
  </form>
</section>
`;
}

function renderCareersView(): string {
  return `<section class="section">
  <h1>Open roles</h1>
  <p>This hiring-shaped starter lists roles here. HiroApp is the full product in <code>apps/hiroapp</code>.</p>
  <ul>
    <li>Staff HTML stays at <code>/</code>.</li>
    <li>Candidate SPA is served under your <code>SPA_PREFIX</code>.</li>
  </ul>
</section>
`;
}

function renderLayout(layers: StarterLayers, projectName: string): string {
  const cookie = authUsesCookie(layers.auth);
  const careers = isHiringRecipe(layers.kit);
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title><%= it.layout.title %> · ${projectName}</title>
    <% if (it.layout.description) { %>
    <meta name="description" content="<%= it.layout.description %>" />
    <% } %>
    <link rel="stylesheet" href="/assets/site.css" />
  </head>
  <body>
    <header class="site-header">
      <a class="brand" href="/">${projectName}</a>
      <nav>
        ${careers ? '<a href="/careers">Careers</a>' : ""}
        ${cookie ? '<a href="/login">Sign in</a>' : ""}
      </nav>
    </header>
    <main><%~ it.body %></main>
  </body>
</html>
`;
}

function renderHomeView(projectName: string, layers: StarterLayers): string {
  const loginLine = authUsesCookie(layers.auth)
    ? '<p>HTML sign-in: <a href="/login">/login</a> (demo@example.com / password).</p>'
    : "";
  const careersLine = isHiringRecipe(layers.kit)
    ? '<p>Public board: <a href="/careers">/careers</a>.</p>'
    : "";
  return `<section class="section">
  <h1>Welcome to ${projectName}</h1>
  <p>Kit <strong>${layers.kit}</strong> is running.</p>
  <p>Health check: <a href="/health"><code>/health</code></a>.</p>
  ${loginLine}
  ${careersLine}
</section>
`;
}

export {
  renderAuthDirectory,
  renderAuthModule,
  renderAuthProvider,
  renderCareersModule,
  renderCareersView,
  renderHomeView,
  renderLayout,
  renderLoginView,
  renderSiteModule,
};
