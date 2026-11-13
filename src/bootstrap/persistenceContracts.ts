import type { AuthUser, CredentialSource } from "@getstrata/core/auth/authContext";
import type { AuthOutcome } from "@getstrata/core/auth/guard";
import type { OrganizationMemberRole } from "@getstrata/core/contracts/membership";
import type { TenantContext } from "@getstrata/core/tenant/tenantContext";

export type {
  EstablishedDatabasePolicy,
  ExecutionPersistence,
  PersistenceInvocation,
  ScopedPolicy,
  SelectedSession,
} from "@getstrata/core/contracts/persistence";

import type { ExecutionPersistence } from "@getstrata/core/contracts/persistence";
export type AuthResolution = Readonly<{
  user: AuthUser | null;
  credentialSource: CredentialSource;
}>;
export interface EstablishedRequest {
  readonly auth: AuthResolution;
  readonly tenant: TenantContext;
  readonly memberships: readonly Readonly<{
    organization_id: number;
    role: OrganizationMemberRole;
  }>[];
}
export interface MetadataPorts {
  authenticate(request: Request): Promise<AuthOutcome>;
  memberships(user: AuthUser): Promise<EstablishedRequest["memberships"]>;
  userTenantId(userId: number): Promise<number>;
  tenant(id: number): Promise<TenantContext | null>;
}
export type MetadataFactory = (ports: ExecutionPersistence) => MetadataPorts;

import type { AuthReader } from "@getstrata/core/auth/authReader";
import type { DatabaseSession, TransactionSession } from "@getstrata/core/database/session";
import type { PublicTenancyOptions } from "@getstrata/core/tenant/publicTenantHost";
export interface BusinessRequestPorts {
  readonly database: DatabaseSession | TransactionSession;
  readonly auth: AuthReader;
  readonly policy: import("@getstrata/core/contracts/persistence").ScopedPolicy;
  readonly established: EstablishedRequest;
}
export type BusinessRouteHandler<TRequest extends Request = Request> = (
  request: TRequest,
  ports: BusinessRequestPorts,
) => Response | Promise<Response>;
export interface HttpPersistenceOptions {
  readonly metadata: MetadataFactory;
  readonly features?: Readonly<{
    emailVerificationRequired: boolean;
    viewsEnabled: boolean;
    publicReadsEnabled: boolean;
    etagEnabled?: boolean;
  }>;
  readonly csrf?: import("@getstrata/core/http/csrfMiddleware").CsrfOptions;
  readonly scim?: (
    request: Request,
    database: DatabaseSession,
  ) => Promise<TenantContext | Response>;
  readonly tenancy: "none" | "column" | "rls";
  readonly production: boolean;
  readonly allowTenantDevHeaders: boolean;
  readonly publicTenancy?: PublicTenancyOptions;
  readonly signatureSecret?: string;
  readonly passwordConfirmation?: import("@getstrata/core/auth/passwordConfirmCookie").PasswordConfirmReadOptions;
}

export type IdentityPolicyMode = "identifier" | "bypass";
