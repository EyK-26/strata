import { renderAuthImports } from './renderImports.ts';
import type { AuthRenderingContext } from './renderingContext.ts';

/** Dependencies belong to the emitted module, not to the old aggregate auth module. */
export function renderAuthHttpImports(
	context: AuthRenderingContext,
	target: 'account' | 'api' | 'web',
): string {
	const { plan, cookie, mfa, verify, github, oidc, jsonAccounts, jsonCookieAccounts } = context;

	const apiMfa = jsonCookieAccounts && mfa;

	const browserMfa = plan.decisions.mfaViews;

	const names = new Set<string>(['StarterAuthServices']);

	const add = (...values: string[]) => {
		for (const value of values) {
			names.add(value);
		}
	};

	if (target === 'account') {
		add(
			'prepareAccountMail',
			'registerAccount',
			'completeAccountToken',
			'authenticatePasswordAccount',
			'withLoginAccount',
			'BusinessRequestPorts',
			'SelectedSession',
			'isUniqueConstraintError',
			'hashPassword',
			'AUTH_ONE_TIME_PURPOSES',
			'consumeOneTimeToken',
			'generateOneTimeToken',
			'hashOneTimeToken',
			'revokeStoredUserSessions',
			'persistConsumedRecoveryHash',
			'absoluteTemporarySignedUrl',
			'createStarterAuthDirectory',
			'withAuthIdentifier',
			'runWithLockedAuthUser',
			'StarterAuthUserRecord',
			'User',
			'AuthOneTimeToken',
		);

		if (cookie) {
			add('randomBytes', 'privateJsonResponse');
		}

		if (mfa) {
			add('ConflictError', 'generateRecoveryCodes', 'hashRecoveryCode');
		}
	} else {
		add('parseLoginCredentials');

		if (target === 'web' || jsonAccounts) {
			add(
				'parseRegisterCredentials',
				'parseForgotPasswordEmail',
				'hashPassword',
				'AUTH_ONE_TIME_PURPOSES',
			);
		}

		if (target === 'web') {
			add('parseFormBody', 'flashResponse');

			if (mfa) {
				add(
					'verifyPassword',
					'completePasswordLogin',
					'createPasswordConfirmCookie',
					'sanitizeInternalPath',
					'buildOtpauthUrl',
					'generateTotpSecret',
					'verifyTotp',
				);
			}

			if (verify) {
				add('assertValidSignature');
			}
		} else {
			add('parseJsonBody', 'privateJsonResponse', 'resolveCsrfTokenForRequest');

			if (plan.decisions.token) {
				add('randomBytes', 'hashApiToken', 'ApiToken');
			}

			if (plan.decisions.jwt) {
				add('signJwt');
			}

			if (cookie) {
				add('createSamlStateCookie', 'verifySamlState', 'clearSamlStateCookie');
			}

			if (github) {
				add(
					'GitHubOAuthProvider',
					'createOAuthStateCookie',
					'clearOAuthStateCookie',
					'verifyOAuthState',
				);
			}

			if (oidc) {
				add(
					'OidcProvider',
					'createOAuthState',
					'verifySignedOAuthStateValue',
					'clearOidcPkceCookie',
					'readOidcPkceCookie',
					'sealOidcPkceCookie',
				);
			}

			if (browserMfa) {
				add('parseFormBody', 'completePasswordLogin');
			}

			if (jsonCookieAccounts && (mfa || verify)) {
				add('ConflictError');
			}

			if (apiMfa) {
				add(
					'verifyPassword',
					'createPasswordConfirmCookie',
					'required',
					'stringRule',
					'validateObject',
					'buildOtpauthUrl',
					'generateTotpSecret',
					'verifyTotp',
				);
			}
		}
	}

	// The catalogue contains named imports only. Select declared dependencies while
	// retaining aliases and type-only imports; never inspect or rewrite handler code.
	const imports = renderAuthImports(context).flatMap((line) => {
		const match = /^(import (?:type )?\{ )(.+)( \} from .+;)$/.exec(line);

		if (!match) {
			throw new Error(`Unsupported auth import declaration: ${line}`);
		}

		const bindings = (match[2] ?? '').split(', ').filter((binding) =>
			names.has(
				binding
					.split(' as ')
					.at(-1)
					?.replace(/^type /, '') ?? '',
			),
		);

		return bindings.length ? [`${match[1]}${bindings.join(', ')}${match[3]}`] : [];
	});

	if (target !== 'account') {
		imports.push(
			'import type { BusinessRouteHandler } from "@getstrata/bootstrap/persistenceContracts";',
		);

		if (target === 'web' || browserMfa) {
			imports.push('import type { NamespacedViewRenderer } from "@getstrata/core/view";');
		}

		const helpers = ['authenticatePasswordUser', 'runWithLoginUser'];

		if (target === 'web' || jsonAccounts) {
			helpers.push('issueSignedAuthMail', 'createRegistration', 'completeSignedPasswordReset');
		}

		if (target === 'web') {
			helpers.push('redirectTo', 'sessionUser');

			if (mfa) {
				helpers.push('runWithLockedAccount', 'persistAuthRecovery', 'enrollMfa');
			}

			if (verify) {
				helpers.push('deferAuthEffect', 'completeSignedEmailVerification');
			}
		} else {
			if (plan.decisions.token) {
				helpers.push('authTimestamp', 'runAuthWrite');
			}

			if (cookie) {
				helpers.push('sessionUser', 'completeBrowserSsoLogin');
			}

			if (plan.decisions.jsonVerification) {
				helpers.push('completeSignedEmailVerification');
			}

			if (jsonAccounts && verify) {
				helpers.push('deferAuthEffect');
			}

			if (apiMfa || browserMfa || (jsonCookieAccounts && verify)) {
				helpers.push('runWithLockedAccount');
			}

			if (browserMfa) {
				helpers.push('persistAuthRecovery', 'redirectTo');
			}

			if (apiMfa) {
				helpers.push('enrollMfa');
			}
		}

		imports.push(`import { ${helpers.join(', ')} } from "../auth/account.ts";`);
	}

	return `${imports.join('\n')}\n`;
}
