import {
  AuthenticationRequiredError,
  type AuthOutcome,
  absentAuth,
  authenticatedAuth,
} from "@getstrata/core/auth/authOutcome";
import { createAsyncContextStore } from "../runtime/asyncContextStore";
import { type AuthUser, type CredentialSource, runWithAuthContext } from "./authContext";

export interface AuthReader {
  authenticate(request?: Request): Promise<AuthOutcome>;
  resolve(request?: Request): Promise<AuthUser | null>;
  resolveWithSource(
    request?: Request,
  ): Promise<{ user: AuthUser | null; credentialSource: CredentialSource }>;
  requireUser(request?: Request): Promise<AuthUser>;
  check(request?: Request): Promise<boolean>;
  user(request?: Request): Promise<AuthUser | null>;
}
type Established = Readonly<{
  request: Request;
  user: AuthUser | null;
  credentialSource: CredentialSource;
}>;
const established = createAsyncContextStore<Established>("@getstrata/establishedRequestAuth");
export function runWithEstablishedAuth<T>(
  request: Request,
  auth: Omit<Established, "request">,
  work: () => T,
): T {
  return established.run(Object.freeze({ request, ...auth }), () =>
    runWithAuthContext(auth.user, auth.credentialSource, work),
  ) as T;
}
/** Reads only an explicitly installed established snapshot; never authenticates. */
export const establishedAuthReader: AuthReader = Object.freeze({
  async authenticate(request?: Request) {
    const { user, credentialSource } = await establishedAuthReader.resolveWithSource(request);
    return user ? authenticatedAuth(user, credentialSource) : absentAuth;
  },
  async resolveWithSource(request?: Request) {
    const value = established.getStore();
    if (!value || (request !== undefined && request !== value.request))
      throw new Error("Authentication request scope mismatch.");
    return { user: value.user, credentialSource: value.credentialSource };
  },
  async resolve(request?: Request) {
    return (await establishedAuthReader.resolveWithSource(request)).user;
  },
  async user(request?: Request) {
    return establishedAuthReader.resolve(request);
  },
  async check(request?: Request) {
    return (await establishedAuthReader.resolve(request)) !== null;
  },
  async requireUser(request?: Request) {
    const user = await establishedAuthReader.resolve(request);
    if (!user) throw new AuthenticationRequiredError();
    return user;
  },
});
