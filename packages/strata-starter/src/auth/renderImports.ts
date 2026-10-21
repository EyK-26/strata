import { authUsesJwt, authUsesToken } from "../types.ts";
import type { AuthRenderingContext } from "./renderingContext.ts";

export function renderAuthImports({
  layers,
  cookie,
  github,
  oidc,
  mfa,
  verify,
  bearerApi,
  jsonCookieAccounts,
  tenantInsert,
}: Pick<
  AuthRenderingContext,
  | "layers"
  | "cookie"
  | "github"
  | "oidc"
  | "mfa"
  | "verify"
  | "bearerApi"
  | "jsonCookieAccounts"
  | "tenantInsert"
>) {
  const imports: string[] = [];
  if (authUsesToken(layers.auth) || cookie) {
    imports.push(`import { randomBytes } from "node:crypto";`);
  }
  imports.push(`import { CORE_AUTH_TOKEN } from "@getstrata/bootstrap/config";`);
  imports.push(`import type { AppModule } from "@getstrata/bootstrap/contracts";`);
  if (cookie) {
    imports.push(`import { parseFormBody } from "@getstrata/bootstrap/web/forms";`);
    imports.push(
      `import { wrapWebLogin, wrapWebRegister } from "@getstrata/bootstrap/web/routing";`,
    );
    imports.push(
      `import type { CookieSessionAuthManager } from "@getstrata/bootstrap/web/session";`,
    );
    imports.push(
      `import { createSamlServiceProvider } from "@getstrata/core/auth/saml/samlServiceProvider";`,
    );
    if (github) {
      imports.push(`import { GitHubOAuthProvider } from "@getstrata/core/auth/oauth/providers";`);
    }
    if (oidc) {
      imports.push(`import { OidcProvider } from "@getstrata/core/auth/oauth/oidcProvider";`);
    }
    if (github || oidc) {
      imports.push(`import { appUrl } from "@getstrata/core/runtime/appKeyPrefix";`);
    }
  }
  imports.push(`import { ConflictError } from "@getstrata/core/errors/http";`);
  if (bearerApi) {
    imports.push(`import { AuthManager } from "@getstrata/core/auth/guard";`);
  }
  if (authUsesJwt(layers.auth)) {
    imports.push(`import { jwtTtlSeconds, signJwt } from "@getstrata/core/auth/jwt";`);
  }
  imports.push(
    `import { afterCommit, runInTransaction } from "@getstrata/core/database/transaction";`,
  );
  imports.push(`import { hashPassword, verifyPassword } from "@getstrata/core/auth/password";`);
  imports.push(
    `import { AUTH_ONE_TIME_PURPOSES, consumeOneTimeToken, generateOneTimeToken, hashOneTimeToken, revokeUserSessions as revokeStoredUserSessions } from "@getstrata/core/auth/oneTimeToken";`,
  );
  imports.push(
    `import { completePasswordLogin, persistConsumedRecoveryHash } from "@getstrata/core/auth/passwordLogin";`,
  );
  if (mfa) {
    imports.push(
      `import { createPasswordConfirmCookie } from "@getstrata/core/auth/passwordConfirmCookie";`,
    );
  }
  if (mfa && jsonCookieAccounts) {
    imports.push(
      `import { createRequirePasswordConfirmMiddleware } from "@getstrata/core/http/requirePasswordConfirmMiddleware";`,
      `import { withMiddleware } from "@getstrata/core/http/routeMiddleware";`,
    );
  }
  imports.push(
    `import { emailRule, minLength, required, stringRule, validateObject } from "@getstrata/core/validation/rules";`,
  );
  imports.push(`import { parseJsonBody } from "@getstrata/core/http/validation";`);
  imports.push(`import { sqlTimestamp } from "@getstrata/core/database/dialect";`);
  if (authUsesToken(layers.auth)) {
    imports.push(`import { hashApiToken } from "@getstrata/core/auth/tokenHash";`);
    imports.push(
      `import { resolveDefaultTokenExpiryDays } from "@getstrata/core/security/tokenExpiry";`,
    );
  }
  if (mfa) {
    imports.push(`import { protectMfaSecret } from "@getstrata/core/crypto/mfaSecret";`);
  }
  if (cookie) {
    imports.push(`import { flashResponse } from "@getstrata/core/http/flashSession";`);
    if (mfa) {
      imports.push(`import { sanitizeInternalPath } from "@getstrata/core/http/safeInternalPath";`);
    }
    imports.push(
      oidc
        ? `import { clearOidcPkceCookie, createOAuthState, readOidcPkceCookie, sealOidcPkceCookie, verifyOAuthState } from "@getstrata/core/security/oauthState";`
        : `import { createOAuthState, verifyOAuthState } from "@getstrata/core/security/oauthState";`,
    );
  }
  if (bearerApi || cookie) {
    imports.push(
      `import { privateJsonResponse, withErrorHandling } from "@getstrata/core/http/response";`,
    );
    imports.push(`import { resolveCsrfTokenForRequest } from "@getstrata/core/http/csrfToken";`);
  }
  imports.push(
    cookie && verify
      ? `import { absoluteTemporarySignedUrl, assertValidSignature } from "@getstrata/core/http/signedUrl";`
      : `import { absoluteTemporarySignedUrl } from "@getstrata/core/http/signedUrl";`,
  );
  imports.push(`import { mailer } from "@getstrata/core/mail/mailer";`);
  if (mfa) {
    imports.push(
      `import { generateRecoveryCodes, hashRecoveryCode } from "@getstrata/core/security/recoveryCodes";`,
    );
    imports.push(
      `import { buildOtpauthUrl, generateTotpSecret, verifyTotp } from "@getstrata/core/security/totp";`,
    );
  }
  if (tenantInsert) {
    imports.push(`import { currentTenantId } from "@getstrata/core/tenant/tenantContext";`);
  }
  imports.push(
    `import { runWithMigrationBypassForIdentifier } from "@getstrata/core/tenant/databaseTenantContext";`,
  );
  imports.push(
    `import { starterAuthDirectory, runWithLockedAuthUser, type StarterAuthUserRecord } from "../../bootstrap/authDirectory.ts";`,
  );
  imports.push(`import { getSql } from "../../bootstrap/database.ts";`);
  imports.push(`import { User } from "../../models/User.ts";`);
  imports.push(`import { AuthOneTimeToken } from "../../models/AuthOneTimeToken.ts";`);
  if (authUsesToken(layers.auth)) {
    imports.push(`import { ApiToken } from "../../models/ApiToken.ts";`);
  }
  if (cookie) {
    imports.push(`import { CORE_VIEW_RENDERER_TOKEN } from "@getstrata/core/view";`);
  }
  if (mfa) {
    imports.push(
      `import { pendingMfaClearCookie, pendingMfaSetCookie, readPendingMfaChallenge } from "../../bootstrap/pendingMfa.ts";`,
    );
  }
  return imports;
}
