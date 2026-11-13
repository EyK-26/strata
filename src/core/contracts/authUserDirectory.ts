import type { AuthUser } from "../auth/authContext";

interface AuthUserRecord {
  id: number;
  name?: string | null;
  email?: string | null;
  role: string;
  /** Optional account-status contract; missing preserves legacy behavior. */
  is_active?: boolean;
  /** Optional non-negative safe-integer credential epoch; never reset on reactivation. */
  auth_version?: number;
  email_verified_at?: Date | string | null;
  session_valid_after?: Date | string | null;
  password?: string | null;
  mfa_enabled?: boolean;
  mfa_secret?: string | null;
  mfa_recovery_codes?: string | null;
}

interface AuthAccountLookup {
  findByIdOrThrow(id: number): Promise<AuthUserRecord>;
}

interface AuthBearerResolver {
  /** Participating resolvers must project fresh account status as AuthUser.isActive. */
  resolveUserFromToken(token: string): Promise<AuthUser | null>;
}

interface AuthSessionValidity {
  hasActiveBrowserSession(userId: number, issuedAt: number): Promise<boolean>;
}

interface AuthEmailLookup {
  findByEmail(email: string): Promise<AuthUserRecord | null>;
}

interface AuthCredentialVerifier {
  verifyCredentials(email: string, password: string): Promise<AuthUser | null>;
}

/** Adapter composition surface. Guards depend on the individual selected capabilities. */
interface AuthUserDirectory
  extends AuthAccountLookup,
    AuthBearerResolver,
    Partial<AuthSessionValidity & AuthEmailLookup & AuthCredentialVerifier> {}

export type {
  AuthAccountLookup,
  AuthBearerResolver,
  AuthCredentialVerifier,
  AuthEmailLookup,
  AuthSessionValidity,
  AuthUserDirectory,
  AuthUserRecord,
};
