import type { RenderedHttpFeature } from "./controllerActions.ts";
import type { StarterFeaturePlan } from "./featurePlan.ts";
import { renderAuthHttp, renderHomeHttp } from "./renderAuthFlows.ts";
import { renderBillingHttp } from "./renderIntegrations.ts";
import { renderScimHttp } from "./renderScim.ts";
import { renderWorkTrackerHttp } from "./renderWorkTracker.ts";

/** Render controller implementations and the two explicit application route entry points. */
export function renderHttpFiles(plan: StarterFeaturePlan): Readonly<Record<string, string>> {
  const features = [
    ...(plan.decisions.serverViews ? [renderHomeHttp()] : []),
    renderAuthHttp(plan),
    ...(plan.decisions.workTracker ? [renderWorkTrackerHttp()] : []),
    renderScimHttp(plan),
    renderBillingHttp(plan),
  ].filter((feature): feature is RenderedHttpFeature => feature !== null);
  const files: Record<string, string> = Object.assign(
    {},
    ...features.map((feature) => feature.files),
  );
  const imports = {
    api: [
      ...(plan.decisions.users
        ? [
            'import { AuthController } from "../http/controllers/AuthController.ts";',
            'import { STARTER_AUTH_SERVICES } from "../bootstrap/auth.ts";',
          ]
        : []),
      ...(plan.decisions.mfaViews
        ? [
            'import { wrapWebLogin } from "@getstrata/bootstrap/web/routing";',
            'import { CORE_VIEW_RENDERER_TOKEN } from "@getstrata/core/view";',
          ]
        : []),
      ...(plan.decisions.workTracker
        ? [
            'import { WorkTrackerController } from "../http/controllers/WorkTrackerController.ts";',
            'import { WORK_TRACKER_OUTBOX } from "../domain/workTracker.ts";',
          ]
        : []),
      ...(plan.decisions.scim
        ? ['import { ScimController, wrapScim } from "../http/controllers/ScimController.ts";']
        : []),
      ...(plan.layers.extras.billing
        ? [
            'import { BillingController } from "../http/controllers/BillingController.ts";',
            'import { APPLICATION_BILLING as STARTER_BILLING_OPTIONS_TOKEN } from "@getstrata/bootstrap/application";',
          ]
        : []),
    ],
    web: [
      ...(plan.decisions.serverViews || plan.decisions.cookie
        ? ['import { CORE_VIEW_RENDERER_TOKEN } from "@getstrata/core/view";']
        : []),
      ...(plan.decisions.serverViews
        ? ['import { HomeController } from "../http/controllers/HomeController.ts";']
        : []),
      ...(plan.decisions.cookie
        ? [
            'import { AuthWebController } from "../http/controllers/AuthWebController.ts";',
            'import { STARTER_AUTH_SERVICES } from "../bootstrap/auth.ts";',
            'import { wrapWebLogin, wrapWebRegister } from "@getstrata/bootstrap/web/routing";',
          ]
        : []),
      ...(plan.decisions.workTracker
        ? [
            'import { WorkTrackerController } from "../http/controllers/WorkTrackerController.ts";',
            'import { WORK_TRACKER_OUTBOX } from "../domain/workTracker.ts";',
          ]
        : []),
    ],
  };
  for (const kind of ["api", "web"] as const) {
    const routes = features.flatMap((feature) => {
      const route = feature[kind];
      return route ? [route] : [];
    });
    files[`routes/${kind}.ts`] =
      `import type { AppRouteMap, ModuleRouteContext } from "@getstrata/bootstrap/contracts";
import { composeRouteMaps } from "@getstrata/bootstrap/routePlan";
${imports[kind].join("\n")}

${routes.map((route) => route.source).join("\n")}
/** Register ${kind === "api" ? "API" : "browser"} endpoints and their middleware here. */
export function ${kind}Routes(context: ModuleRouteContext): AppRouteMap {
  return composeRouteMaps(${routes.map((route) => `${route.name}(context)`).join(", ")});
}
`;
  }
  files["routes/index.ts"] =
    `import { buildApplicationRoutes } from "@getstrata/bootstrap/application";
import type { AppDependencies, AppModule } from "@getstrata/bootstrap/contracts";
import type { FrontendMode } from "@getstrata/core/runtime/frontendMode";
import { apiRoutes } from "./api.ts";
import { webRoutes } from "./web.ts";

/** App routes use the same kernel and middleware boundaries as optional modules. */
export function applicationRoutes(dependencies: AppDependencies, modules: readonly AppModule[], options: { frontend: FrontendMode }) {
  return buildApplicationRoutes(dependencies, [
    ...modules,
    { name: "application", routes: apiRoutes, webRoutes },
  ], options);
}
`;
  return files;
}
