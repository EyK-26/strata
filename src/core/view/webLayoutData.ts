import { currentAuthUser } from "@getstrata/core/auth/authContext";
import { currentRequestMeta } from "@getstrata/core/http/requestMetaContext";
import type { ServiceContainerLike } from "../contracts/serviceContainer";
import { resolveAuthUserDirectory } from "../contracts/serviceTokens";
import { resolveCsrfTokenForRequest } from "../http/csrfToken";
import { pullFlash } from "../http/flashSession";

interface WebLayoutAuthUser {
  id: number;
  email: string;
  role: string;
  [key: string]: unknown;
}

interface WebLayoutData {
  authUser?: WebLayoutAuthUser | null;
  currentUser?: WebLayoutAuthUser | null;
  csrfToken: string;
  flash: { level: string; message: string } | null;
  [key: string]: unknown;
}

type WebLayoutUserKey = "authUser" | "currentUser";

interface WebLayoutDataOptions {
  userKey?: WebLayoutUserKey;
  loadUser?: (
    container: ServiceContainerLike,
    request: Request | undefined,
  ) => Promise<Record<string, unknown> | null>;
  extra?:
    | Record<string, unknown>
    | ((
        user: Record<string, unknown> | null,
      ) => Record<string, unknown> | Promise<Record<string, unknown>>);
}

let configuredLayoutOptions: WebLayoutDataOptions = {};

function configureWebLayoutData(options: WebLayoutDataOptions): void {
  configuredLayoutOptions = { ...options };
}

function resetWebLayoutDataConfigForTests(): void {
  configuredLayoutOptions = {};
}

function layoutUserKey(options: WebLayoutDataOptions): WebLayoutUserKey {
  return options.userKey ?? "authUser";
}

async function defaultLoadLayoutUser(
  container: ServiceContainerLike,
  _request: Request | undefined,
): Promise<Record<string, unknown> | null> {
  const authUser = currentAuthUser();

  if (!authUser) {
    return null;
  }

  const userId = Number(authUser.id);

  if (!Number.isInteger(userId) || userId <= 0) {
    return null;
  }

  const directory = resolveAuthUserDirectory(container);

  if (!directory) {
    return {
      id: userId,
      email: "",
      role: authUser.role ?? "member",
    };
  }

  try {
    const user = await directory.findByIdOrThrow(userId);

    return {
      id: userId,
      email: user.email ?? "",
      role: authUser.role ?? user.role ?? "member",
    };
  } catch {
    return null;
  }
}

async function resolveWebLayoutData(
  container: ServiceContainerLike,
  request?: Request,
  options: WebLayoutDataOptions = {},
): Promise<Record<string, unknown>> {
  const resolved: WebLayoutDataOptions = { ...configuredLayoutOptions, ...options };
  const csrfToken = request ? resolveCsrfTokenForRequest(request) : "";
  const flash = request ? (currentRequestMeta().flash ?? pullFlash(request)) : null;
  const userKey = layoutUserKey(resolved);
  const loadUser = resolved.loadUser ?? defaultLoadLayoutUser;
  const user = await loadUser(container, request);
  const extra =
    typeof resolved.extra === "function" ? await resolved.extra(user) : (resolved.extra ?? {});

  return {
    [userKey]: user,
    csrfToken,
    flash,
    cspNonce: currentRequestMeta().cspNonce ?? "",
    ...extra,
  };
}

export type { WebLayoutAuthUser, WebLayoutData, WebLayoutDataOptions, WebLayoutUserKey };
export { configureWebLayoutData, resetWebLayoutDataConfigForTests, resolveWebLayoutData };
