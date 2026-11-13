import type { AuthRenderingContext } from "./renderingContext.ts";

export function renderAuthImports({
  plan,
  cookie,
  github,
  oidc,
  mfa,
}: Pick<
  AuthRenderingContext,
  "plan" | "cookie" | "github" | "oidc" | "mfa" | "verify" | "bearerApi" | "jsonCookieAccounts"
>) {
  const imports: string[] = [];

  if (plan.decisions.token || cookie) {
    imports.push(`import { randomBytes } from "node:crypto";`);
  }
  imports.push(
    `import type { BusinessRequestPorts } from "@getstrata/bootstrap/persistenceContracts";`,
  );
  imports.push(`import type { SelectedSession } from "@getstrata/core/contracts/persistence";`);
  imports.push(
    `import { STARTER_AUTH_SERVICES, type StarterAuthServices } from "../../bootstrap/providers/auth.ts";`,
  );
  imports.push(`import type { AppModule } from "@getstrata/bootstrap/contracts";`);
  if (cookie) {
    imports.push(`import { parseFormBody } from "@getstrata/bootstrap/web/forms";`);
    imports.push(
      `import { wrapWebLogin, wrapWebRegister } from "@getstrata/bootstrap/web/routing";`,
    );
    if (github) {
      imports.push(`import { GitHubOAuthProvider } from "@getstrata/core/auth/oauth/providers";`);
    }
    if (oidc) {
      imports.push(`import { OidcProvider } from "@getstrata/core/auth/oauth/oidcProvider";`);
    }
  }
  imports.push(`import { ConflictError } from "@getstrata/core/errors/http";`);
  imports.push(`import { isUniqueConstraintError } from "@getstrata/core/database/errors";`);
  if (plan.decisions.jwt) {
    imports.push(`import { signJwt } from "@getstrata/core/auth/jwt";`);
  }
  imports.push(`import { hashPassword, verifyPassword } from "@getstrata/core/auth/password";`);
  imports.push(
    `import { AUTH_ONE_TIME_PURPOSES, consumeOneTimeToken, generateOneTimeToken, hashOneTimeToken, revokeUserSessions as revokeStoredUserSessions } from "@getstrata/core/auth/oneTimeToken";`,
  );
  imports.push(
    `import { completePasswordLogin, persistConsumedRecoveryHash, type PasswordLoginResult } from "@getstrata/core/auth/passwordLogin";`,
  );
  if (mfa) {
    imports.push(
      `import { createPasswordConfirmCookie } from "@getstrata/core/auth/passwordConfirmCookie";`,
    );
  }
  imports.push(
    `import { emailRule, minLength, required, stringRule, validateObject } from "@getstrata/core/validation/rules";`,
  );
  imports.push(`import { parseJsonBody } from "@getstrata/core/http/validation";`);
  if (plan.decisions.token) {
    imports.push(`import { hashApiToken } from "@getstrata/core/auth/tokenHash";`);
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
  if (plan.decisions.users) {
    imports.push(`import { privateJsonResponse } from "@getstrata/core/http/response";`);
    imports.push(`import { resolveCsrfTokenForRequest } from "@getstrata/core/http/csrfToken";`);
  }
  imports.push(
    plan.decisions.cookieVerification
      ? `import { absoluteTemporarySignedUrl, assertValidSignature } from "@getstrata/core/http/signedUrl";`
      : `import { absoluteTemporarySignedUrl } from "@getstrata/core/http/signedUrl";`,
  );
  if (mfa) {
    imports.push(
      `import { generateRecoveryCodes, hashRecoveryCode } from "@getstrata/core/security/recoveryCodes";`,
    );
    imports.push(
      `import { buildOtpauthUrl, generateTotpSecret, verifyTotp } from "@getstrata/core/security/totp";`,
    );
  }
  imports.push(
    `import { createStarterAuthDirectory, withAuthIdentifier, runWithLockedAuthUser, type StarterAuthUserRecord } from "../../bootstrap/authDirectory.ts";`,
  );
  imports.push(`import { User } from "../../models/User.ts";`);
  imports.push(`import { AuthOneTimeToken } from "../../models/AuthOneTimeToken.ts";`);
  if (plan.decisions.token) {
    imports.push(`import { ApiToken } from "../../models/ApiToken.ts";`);
  }
  if (cookie) {
    imports.push(`import { CORE_VIEW_RENDERER_TOKEN } from "@getstrata/core/view";`);
  }
  return imports;
}
