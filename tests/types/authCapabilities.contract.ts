/** Compiled contracts; not executed. */
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
  new SessionGuard(accounts, { read: () => null, abilities: () => [], validity });
  new SessionGuard(accounts, { read: () => null, abilities: () => [], validity: null });
  new BasicAuthGuard({ accounts, emailLookup, persistRecovery });
  new BasicAuthGuard({ accounts, credentials, persistRecovery });
  // @ts-expect-error An account lookup is not a bearer resolver.
  new DatabaseTokenGuard(accounts);
  // @ts-expect-error A bearer resolver is not an account lookup.
  new JwtGuard({ directory: tokens, secret: "fixture-key" });
  // @ts-expect-error Session registry selection is explicit, including account-only null.
  new SessionGuard(accounts, { read: () => null, abilities: () => [] });
  // @ts-expect-error Basic requires at least one credential lookup capability.
  new BasicAuthGuard({ accounts, persistRecovery });
}
