import { establishedAuthReader, runWithEstablishedAuth } from "@getstrata/core/auth/authReader";
import { type AuthOutcome, validatedAuthOutcome } from "@getstrata/core/auth/guard";
import { runWithMembershipSnapshot } from "@getstrata/core/auth/membershipContext";
import type { ApplicationConfig } from "@getstrata/core/contracts/application";
import type { PersistenceInvocation } from "@getstrata/core/contracts/persistence";
import { InternalServerError, InvalidCredentialsError } from "@getstrata/core/errors/http";
import { currentRequestMeta } from "@getstrata/core/http/requestMetaContext";
import { errorResponse } from "@getstrata/core/http/response";
import { webErrorResponse } from "@getstrata/core/http/webErrorResponse";
import { createPublicTenantSelector } from "@getstrata/core/tenant/publicTenantHost";
import { runWithTenant, type TenantContext } from "@getstrata/core/tenant/tenantContext";
import { DEFAULT_TENANT, resolveTenantForRequest } from "@getstrata/core/tenant/tenantMiddleware";
import { businessPorts } from "#strata-http-route";
import type {
  BusinessRequestPorts,
  BusinessRouteHandler,
  EstablishedRequest,
  HttpPersistenceOptions,
  IdentityPolicyMode,
} from "./persistenceContracts";

export { HTTP_PERSISTENCE_OPTIONS } from "#strata-http-route";

function snapshotAuth(input: AuthOutcome): EstablishedRequest["auth"] {
  const auth = validatedAuthOutcome(input);
  if (auth.status === "error")
    throw Object.assign(new InternalServerError(), { cause: auth.error });
  if (auth.status === "invalid") throw new InvalidCredentialsError();
  const user = auth.user;
  const name = user?.name;
  const email = user?.email;
  return Object.freeze({
    credentialSource: auth.credentialSource,
    user: user
      ? Object.freeze({
          id: user.id,
          ...(typeof name === "string" ? { name } : {}),
          ...(typeof email === "string" ? { email } : {}),
          ...(user.role !== undefined ? { role: user.role } : {}),
          ...(user.isActive !== undefined ? { isActive: user.isActive } : {}),
          ...(user.authVersion !== undefined ? { authVersion: user.authVersion } : {}),
          ...(user.tokenId !== undefined ? { tokenId: user.tokenId } : {}),
          ...(user.abilities
            ? { abilities: Object.freeze([...user.abilities]) as unknown as string[] }
            : {}),
          ...(user.emailVerifiedAt !== undefined
            ? {
                emailVerifiedAt:
                  user.emailVerifiedAt instanceof Date
                    ? user.emailVerifiedAt.toISOString()
                    : user.emailVerifiedAt,
              }
            : {}),
        })
      : null,
  });
}
function snapshotTenant(tenant: TenantContext): TenantContext {
  const snapshot = structuredClone(tenant);
  if (
    !snapshot ||
    typeof snapshot !== "object" ||
    Array.isArray(snapshot) ||
    !Number.isSafeInteger(snapshot.id) ||
    snapshot.id < 1 ||
    typeof snapshot.slug !== "string"
  )
    throw new TypeError("HTTP metadata must establish a valid tenant identity.");
  return Object.freeze(snapshot);
}
export function createHttpPersistence(
  invoke: PersistenceInvocation,
  options: HttpPersistenceOptions,
) {
  const invalidSessionCookie = options.invalidSessionCookie
    ? Object.freeze({ ...options.invalidSessionCookie })
    : undefined;
  const selectPublic = options.publicTenancy
    ? createPublicTenantSelector(options.publicTenancy)
    : undefined;
  return async <T extends Request>(
    request: T,
    handler: BusinessRouteHandler<T>,
    identity?: readonly IdentityPolicyMode[],
    scim = false,
  ): Promise<Response> => {
    const externalId = currentRequestMeta().requestId;
    const metadata = { routeTemplate: currentRequestMeta().routeTemplate ?? "", phase: "metadata" };
    const established = await invoke(
      {
        kind: "request",
        externalId,
        signal: request.signal,
        metadata,
        actor: { kind: "system", policy: "http.identity-metadata" },
      },
      async (ports) => {
        if (scim) {
          if (!options.scim) throw new Error("Explicit SCIM metadata authentication is required.");
          const tenant = await options.scim(request, ports.database);
          if (tenant instanceof Response) return tenant;
          return Object.freeze({
            auth: Object.freeze({ user: null, credentialSource: "bearer" as const }),
            memberships: Object.freeze([]),
            tenant: snapshotTenant(tenant),
          });
        }
        const lookup = options.metadata(ports);
        const outcome = validatedAuthOutcome(await lookup.authenticate(request));
        if (
          outcome.status === "invalid" &&
          outcome.credentialSource === "session" &&
          invalidSessionCookie &&
          request.headers
            .get("cookie")
            ?.split(";")
            .some((part) => part.trim().startsWith(`${invalidSessionCookie.name}=`))
        ) {
          const error = new InvalidCredentialsError();
          const response = (await webErrorResponse(error, request)) ?? errorResponse(error);
          response.headers.append("Set-Cookie", invalidSessionCookie.expiredHeader);
          return response;
        }
        const auth = snapshotAuth(outcome);
        const memberships = auth.user ? await lookup.memberships(auth.user) : [];
        const resolveTenant = async (id: number) => {
          const result = await lookup.tenant(id);
          if (result === null) return null;
          const snapshot = snapshotTenant(result);
          if (snapshot.id !== id)
            throw new Error("Tenant resolver returned a different tenant identity.");
          return snapshot;
        };
        const tenant =
          options.tenancy === "none"
            ? snapshotTenant(DEFAULT_TENANT)
            : await resolveTenantForRequest(
                request,
                {
                  auth,
                  config: {
                    enabled: true,
                    production: options.production,
                    allowDevHeaders: options.allowTenantDevHeaders,
                  },
                  resolveTenant,
                  userTenantId: lookup.userTenantId,
                },
                resolveTenant,
                selectPublic,
              );
        return Object.freeze({
          auth,
          tenant,
          memberships: Object.freeze(memberships.map((row) => Object.freeze({ ...row }))),
        });
      },
    );
    if (established instanceof Response) return established;
    const claims: Record<string, string | number | boolean | readonly string[] | null> = {};
    if (established.auth.user) {
      for (const [key, value] of Object.entries(established.auth.user))
        if (value !== undefined) {
          if (
            value === null ||
            typeof value === "string" ||
            typeof value === "number" ||
            typeof value === "boolean" ||
            Array.isArray(value)
          )
            claims[key] = value;
        }
    }
    return invoke(
      {
        kind: "request",
        externalId,
        signal: request.signal,
        metadata: {
          ...metadata,
          phase: identity ? "identity-operation" : "business",
          credentialSource: established.auth.credentialSource,
        },
        ...(scim
          ? { actor: { kind: "system" as const, policy: "http.scim" } }
          : identity
            ? { actor: { kind: "system" as const, policy: "http.identity-operation" } }
            : established.auth.user
              ? { actor: { kind: "principal" as const, claims: claims as ApplicationConfig } }
              : {}),
        tenant: { id: established.tenant.id, slug: established.tenant.slug },
      },
      (ports) => {
        const policy: import("@getstrata/core/contracts/persistence").ScopedPolicy = Object.freeze<
          import("@getstrata/core/contracts/persistence").ScopedPolicy
        >({
          run: (selected, mode, work) => {
            const allowed =
              mode.kind === "tenant"
                ? identity === undefined
                : identity?.includes(mode.kind) === true;
            if (!allowed)
              throw new Error("Database policy is not allowed by this route declaration.");
            return ports.policy.run(selected, mode, work);
          },
        });
        const work = (database: BusinessRequestPorts["database"]) =>
          runWithEstablishedAuth(request, established.auth, () =>
            runWithMembershipSnapshot(established.memberships, () => {
              const execute = () =>
                handler(
                  request,
                  businessPorts({
                    database,
                    auth: establishedAuthReader,
                    established,
                    policy,
                  }),
                );
              return runWithTenant(established.tenant, execute);
            }),
          );
        return !identity && options.tenancy === "rls"
          ? ports.policy.run(
              ports.database,
              { kind: "tenant", tenantId: established.tenant.id },
              work,
            )
          : work(ports.database);
      },
    );
  };
}
