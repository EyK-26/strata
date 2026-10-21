import { renderApiAuthRoutes } from "./auth/renderApiRoutes.ts";
import { renderBrowserAuthRoutes } from "./auth/renderBrowserRoutes.ts";
import { renderAuthImports } from "./auth/renderImports.ts";
import { createAuthRenderingContext } from "./auth/renderingContext.ts";
import { renderAuthHelpers, renderMfaEnrollment } from "./auth/renderWorkflows.ts";
import { authNeedsUsers, type StarterLayers } from "./types.ts";

function renderPendingMfaTs(): string {
  return `import { createPendingMfaCookie, clearPendingMfaCookie, readPendingMfaCookie } from "@getstrata/core/auth/pendingMfaCookie";
import { sessionSecret } from "./config.ts";

export function pendingMfaSetCookie(userId: number, authVersion: number): string {
  return createPendingMfaCookie(userId, authVersion, sessionSecret());
}
export const pendingMfaClearCookie = clearPendingMfaCookie;
export function readPendingMfaChallenge(request: Request) {
  return readPendingMfaCookie(request, sessionSecret());
}
`;
}

function renderSiteModule(_layers: StarterLayers): string {
  return `import type { AppModule } from "@getstrata/bootstrap/contracts";
import { CORE_VIEW_RENDERER_TOKEN } from "@getstrata/core/view";

const siteModule: AppModule = {
  name: "site",
  order: 1,
  webRoutes({ kernel, dependencies }) {
    const views = dependencies.container.resolve(CORE_VIEW_RENDERER_TOKEN);
    return {
      "/": kernel.wrapWeb(async (request) =>
        views.renderHtmx("home.eta", { layout: { title: "Welcome", description: "Welcome to your Strata app. Restyle views/home.eta and public/assets/site.css." } }, { request }),
      ),
    };
  },
};

export default siteModule;
`;
}

function renderAuthModule(layers: StarterLayers): string | null {
  if (!authNeedsUsers(layers.auth)) return null;
  const context = createAuthRenderingContext(layers);
  const imports = renderAuthImports(context);
  const helpers = renderAuthHelpers(context);
  const apiRoutes = renderApiAuthRoutes(context);
  const cookieRoutes = renderBrowserAuthRoutes(context);
  return `${imports.join("\n")}
${helpers}

${renderMfaEnrollment(context.mfa)}

const authModule: AppModule = {
  name: "auth",
  order: 2,${apiRoutes}${cookieRoutes}
};

export default authModule;
`;
}

export { renderAuthModule, renderPendingMfaTs, renderSiteModule };
