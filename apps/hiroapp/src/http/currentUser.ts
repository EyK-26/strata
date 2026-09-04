import type { CookieSessionAuthManager } from "@getstrata/bootstrap/web/session";
import { currentAuthUser } from "@getstrata/core/auth/authContext";
import type { Policy, PolicyGate } from "@getstrata/core/auth/policy";
import type { ServiceContainer } from "@getstrata/core/contracts/container";
import { CORE_AUTH_TOKEN, CORE_POLICY_GATE_TOKEN } from "@getstrata/core/contracts/serviceTokens";
import { ForbiddenError, UnauthorizedError } from "@getstrata/core/errors/http";
import { type UserRecord, users } from "../modules/users/repository.ts";

let container: ServiceContainer | undefined;

export function bindHttpContainer(next: ServiceContainer) {
  container = next;
}

function requireContainer() {
  if (!container) {
    throw new Error("HTTP container is not bound. createApp() must run first.");
  }
  return container;
}

export function authManager() {
  return requireContainer().resolve<CookieSessionAuthManager>(CORE_AUTH_TOKEN);
}

export function policyGate() {
  return requireContainer().resolve<PolicyGate>(CORE_POLICY_GATE_TOKEN);
}

export async function resolveCurrentUser(request: Request): Promise<UserRecord | null> {
  const authUser = currentAuthUser() ?? (await authManager().resolve(request));
  if (!authUser) {
    return null;
  }
  return users.findById(Number(authUser.id));
}

export async function requireCurrentUser(request: Request): Promise<UserRecord> {
  const user = await resolveCurrentUser(request);
  if (!user) {
    throw new UnauthorizedError();
  }
  return user;
}

export async function authorize(
  request: Request,
  resource: string,
  action: keyof Policy,
  model?: unknown,
) {
  const user = await requireCurrentUser(request);
  policyGate().authorize(resource, action, user, model);
  return user;
}

export function denyUnless(condition: boolean, message = "Forbidden") {
  if (!condition) {
    throw new ForbiddenError(message);
  }
}
