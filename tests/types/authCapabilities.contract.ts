/** Compiled contracts; not executed. */

import type { AuthReader } from "@getstrata/core/auth/authReader";
import { BasicAuthGuard } from "@getstrata/core/auth/basicAuthGuard";
import { DatabaseTokenGuard } from "@getstrata/core/auth/guard";
import { JwtGuard } from "@getstrata/core/auth/jwtGuard";
import { SessionGuard } from "@getstrata/core/auth/sessionGuard";
import type {
  AuthAccountLookup,
  AuthBearerResolver,
  AuthCredentialVerifier,
  AuthEmailLookup,
  AuthSessionValidity,
} from "@getstrata/core/contracts/authUserDirectory";
import { createMfaSecretCodec } from "@getstrata/core/crypto/mfaSecret";
import { createAuthMiddleware } from "@getstrata/core/http/authMiddleware";
import { createRequireAuthMiddleware } from "@getstrata/core/http/requireAuthMiddleware";

export function authCapabilityContracts(
  accounts: AuthAccountLookup,
  tokens: AuthBearerResolver,
  emailLookup: AuthEmailLookup,
  credentials: AuthCredentialVerifier,
  validity: AuthSessionValidity,
) {
  const persistRecovery = async () => false;
  new DatabaseTokenGuard(tokens);
  new JwtGuard({ directory: accounts, secret: "fixture-key" });
  new SessionGuard(accounts, {
    read: () => null,
    hasCredential: () => false,
    abilities: () => [],
    validity,
  });
  new SessionGuard(accounts, {
    read: () => null,
    hasCredential: () => false,
    abilities: () => [],
    validity: null,
  });
  new BasicAuthGuard({
    mfaSecrets: createMfaSecretCodec(process.env),
    accounts,
    emailLookup,
    persistRecovery,
  });
  new BasicAuthGuard({
    mfaSecrets: createMfaSecretCodec(process.env),
    accounts,
    credentials,
    persistRecovery,
  });
  // @ts-expect-error An account lookup is not a bearer resolver.
  new DatabaseTokenGuard(accounts);
  // @ts-expect-error A bearer resolver is not an account lookup.
  new JwtGuard({ directory: tokens, secret: "fixture-key" });
  // @ts-expect-error Session registry selection is explicit, including account-only null.
  new SessionGuard(accounts, { read: () => null, hasCredential: () => false, abilities: () => [] });
  // @ts-expect-error Basic requires at least one credential lookup capability.
  new BasicAuthGuard({ mfaSecrets: createMfaSecretCodec(process.env), accounts, persistRecovery });
}

/** Custom middleware adapters need only the capability their middleware consumes. */
export function middlewareCapabilityContracts(
  authenticator: Pick<AuthReader, "authenticate">,
  checker: Pick<AuthReader, "check">,
) {
  createAuthMiddleware(authenticator);
  createRequireAuthMiddleware(checker);
  // @ts-expect-error A checker cannot authenticate and establish an identity.
  createAuthMiddleware(checker);
  // @ts-expect-error Authentication outcomes do not replace the boolean check capability.
  createRequireAuthMiddleware(authenticator);
}
