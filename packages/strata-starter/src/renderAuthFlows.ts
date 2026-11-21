import { renderApiAuthRoutes } from './auth/renderApiRoutes.ts';
import { renderBrowserAuthRoutes } from './auth/renderBrowserRoutes.ts';
import { renderAuthHttpImports } from './auth/renderHttpImports.ts';
import { renderAuthImports } from './auth/renderImports.ts';
import { renderAuthHelpers, renderMfaEnrollment } from './auth/renderWorkflows.ts';
import { createAuthRenderingContext } from './auth/renderingContext.ts';
import { ControllerActions, type RenderedHttpFeature } from './controllerActions.ts';
import type { StarterFeaturePlan } from './featurePlan.ts';

function renderPendingMfaTs(): string {
	return `import { createPendingMfaCookie, clearPendingMfaCookie, readPendingMfaCookie } from "@getstrata/core/auth/pendingMfaCookie";

export function createPendingMfaHelpers(options: Readonly<{secret:string;production:boolean}>) {
  const snapshot = Object.freeze({...options});

  return Object.freeze({
    setCookie: (userId: number, authVersion: number) => createPendingMfaCookie(userId, authVersion, snapshot.secret, snapshot.production),
    clearCookie: () => clearPendingMfaCookie(snapshot.production),
    read: (request: Request) => readPendingMfaCookie(request, snapshot.secret),
  });
}
`;
}

function renderSiteModule(_plan: StarterFeaturePlan): string {
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

function renderAuthModule(plan: StarterFeaturePlan): string | null {
	if (!plan.decisions.users) {
		return null;
	}

	const context = createAuthRenderingContext(plan);

	const imports = renderAuthImports(context);

	const helpers = renderAuthHelpers(context);

	const apiRoutes = renderApiAuthRoutes(context);

	const cookieRoutes = renderBrowserAuthRoutes(context);

	return `${imports.join('\n')}
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

/** App-owned HTTP actions; account transactions and security workflows stay package-provided. */
export function renderAuthHttp(plan: StarterFeaturePlan): RenderedHttpFeature | null {
	if (!plan.decisions.users) {
		return null;
	}

	const context = createAuthRenderingContext(plan);

	const imports = renderAuthHttpImports(context, 'account');

	const helperNames = [
		'runWithLockedAccount',
		'authTimestamp',
		'deferAuthEffect',
		'authenticatePasswordUser',
		'runWithLoginUser',
		'runAuthWrite',
		'issueSignedAuthMail',
		'createRegistration',
		'completeSignedPasswordReset',
		'persistAuthRecovery',
		...(context.verify ? ['completeSignedEmailVerification'] : []),
		...(context.cookie ? ['redirectTo', 'sessionUser', 'completeBrowserSsoLogin'] : []),
		...(context.mfa ? ['enrollMfa'] : []),
	];

	const helpers = `${imports}
${renderAuthHelpers(context)}
${renderMfaEnrollment(context.mfa)}
export { ${helperNames.join(', ')} };
`;

	const apiActions = new ControllerActions('AuthController');

	const api = renderApiAuthRoutes(context, apiActions);

	const apiScope = ['authServices', ...(plan.decisions.mfaViews ? ['views'] : [])];

	const construction = (views: boolean) =>
		`  constructor(private readonly authServices: StarterAuthServices${views ? ', private readonly views: NamespacedViewRenderer' : ''}) {}`;

	const files: Record<string, string> = {
		'http/auth/account.ts': helpers,
		'http/controllers/AuthController.ts':
			`${renderAuthHttpImports(context, 'api')}\n` +
			apiActions.render(construction(plan.decisions.mfaViews), apiScope),
	};

	const webActions = new ControllerActions('AuthWebController');

	const web = renderBrowserAuthRoutes(context, webActions);

	if (web) {
		files['http/controllers/AuthWebController.ts'] =
			`${renderAuthHttpImports(context, 'web')}\n` +
			webActions.render(construction(true), ['authServices', 'views']);
	}

	return {
		files,
		api: { name: 'authApiRoutes', source: api },
		...(web ? { web: { name: 'authWebRoutes', source: web } } : {}),
	};
}

export function renderHomeHttp(): RenderedHttpFeature {
	return {
		files: {
			'http/controllers/HomeController.ts': `import type { BusinessRouteHandler } from "@getstrata/bootstrap/persistenceContracts";
import type { ViewRenderer } from "@getstrata/core/view";

export class HomeController {
  constructor(private readonly views: ViewRenderer) {}

  index: BusinessRouteHandler = async (request) =>
    this.views.renderHtmx("home.eta", { layout: { title: "Welcome", description: "Welcome to your Strata app. Restyle views/home.eta and public/assets/site.css." } }, { request });
}
`,
		},
		web: {
			name: 'homeWebRoutes',
			source: `export function homeWebRoutes(context: ModuleRouteContext): AppRouteMap {
  const views = context.dependencies.container.resolve(CORE_VIEW_RENDERER_TOKEN);

  const controller = new HomeController(views);

  return { "/": context.kernel.wrapWeb(controller.index) };
}
`,
		},
	};
}
