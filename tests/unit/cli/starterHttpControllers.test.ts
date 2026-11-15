import { expect, test } from "bun:test";
import { compileStarterFeatures } from "../../../packages/strata-starter/src/featurePlan.ts";
import {
  layersFromFlags,
  parseCreateStrataArgs,
} from "../../../packages/strata-starter/src/parseArgs.ts";
import {
  renderAuthModule,
  renderSiteModule,
} from "../../../packages/strata-starter/src/renderAuthFlows.ts";
import { renderHttpFiles } from "../../../packages/strata-starter/src/renderHttp.ts";
import { renderBillingModule } from "../../../packages/strata-starter/src/renderIntegrations.ts";
import { renderScimModule } from "../../../packages/strata-starter/src/renderScim.ts";
import { renderWorkTrackerModule } from "../../../packages/strata-starter/src/renderWorkTracker.ts";
import profiles from "../../fixtures/scaffolds/auth-rendering-canonical.sha256.json";

function boundaries(source: string): string[] {
  return [...source.matchAll(/\b(kernel\.wrap\w*|wrapWebLogin|wrapWebRegister|wrapScim)\s*\(/g)]
    .map((match) => match[1] ?? "")
    .sort();
}

for (const { name, args } of profiles) {
  test(`controller separation preserves every HTTP boundary: ${name}`, () => {
    const plan = compileStarterFeatures(layersFromFlags(parseCreateStrataArgs(args)));
    const files = renderHttpFiles(plan);
    const aggregate = [
      renderAuthModule(plan) ?? "",
      ...(plan.decisions.serverViews ? [renderSiteModule(plan)] : []),
    ].join("\n");
    expect(boundaries(Object.values(files).join("\n"))).toEqual(boundaries(aggregate));
    for (const [path, source] of Object.entries(files)) {
      expect(() => new Bun.Transpiler({ loader: "ts" }).transformSync(source), path).not.toThrow();
      if (path.startsWith("routes/")) expect(source, path).not.toMatch(/\basync\s*\(/);
      if (path.includes("/controllers/"))
        expect(source, path).toMatch(/export class \w+Controller/);
    }
    expect(files["routes/index.ts"]).toContain("buildApplicationRoutes(dependencies");
  });
}

test("optional integration and work controllers retain their admission and transaction declarations", () => {
  const plan = compileStarterFeatures(
    layersFromFlags(
      parseCreateStrataArgs([
        "--frontend=server-htmx",
        "--database=postgres",
        "--auth=cookie-token-jwt",
        "--tenancy=rls",
        "--scim",
        "--billing",
        "--mfa",
        "--email-verification",
      ]),
    ),
    "work-tracker",
  );
  const files = renderHttpFiles(plan);
  const aggregate = [
    renderAuthModule(plan),
    renderSiteModule(plan),
    renderScimModule(plan),
    renderBillingModule(plan),
    renderWorkTrackerModule(),
  ].join("\n");
  expect(boundaries(Object.values(files).join("\n"))).toEqual(boundaries(aggregate));
  expect(files["http/requests/WorkRequest.ts"]).toContain("export async function readWorkFields");
  for (const [path, source] of Object.entries(files)) {
    expect(() => new Bun.Transpiler({ loader: "ts" }).transformSync(source), path).not.toThrow();
    if (path.startsWith("routes/")) expect(source).not.toMatch(/\basync\s*\(/);
  }
});

test("controllers accept concrete capabilities and keep service resolution in route composition", () => {
  for (const frontend of ["api", "server-htmx"] as const) {
    const plan = compileStarterFeatures(
      layersFromFlags(
        parseCreateStrataArgs([
          `--frontend=${frontend}`,
          "--database=postgres",
          "--auth=cookie-token-jwt",
          "--tenancy=rls",
          "--scim",
          "--billing",
          "--mfa",
          "--email-verification",
        ]),
      ),
      "work-tracker",
    );
    const files = renderHttpFiles(plan);
    for (const [path, source] of Object.entries(files)) {
      expect(() => new Bun.Transpiler({ loader: "ts" }).transformSync(source), path).not.toThrow();
      if (!path.includes("/controllers/")) continue;
      expect(source, path).not.toMatch(
        /ModuleRouteContext|\.container\.|STARTER_AUTH_SERVICES|CORE_VIEW_RENDERER_TOKEN|STARTER_BILLING_OPTIONS_TOKEN|WORK_TRACKER_OUTBOX/,
      );
    }
    expect(files["http/controllers/AuthController.ts"]).toContain(
      "private readonly authServices: StarterAuthServices",
    );
    expect(files["http/controllers/AuthWebController.ts"]).toContain(
      "private readonly views: NamespacedViewRenderer",
    );
    expect(files["http/controllers/BillingController.ts"]).toContain(
      "private readonly billingEnabled: boolean",
    );
    expect(files["http/controllers/WorkTrackerController.ts"]).toContain(
      "private readonly publisher: WorkPublisher",
    );
    expect(files["routes/api.ts"]).toContain("new BillingController(enabled, stripeSecret)");
    expect(files["routes/web.ts"]).toContain("new AuthWebController(authServices, views)");
  }
});
