import { currentAuthUser } from "@getstrata/core/auth/authContext";
import { resolveAuthUserDirectory } from "@getstrata/core/contracts/serviceTokens";
import { currentRequestMeta } from "@getstrata/core/http/requestMetaContext";
import type { ServiceContainerLike } from "../contracts/serviceContainer";
import { type CsrfTokenOptions, resolveCsrfTokenForRequest } from "../http/csrfToken";
import { type FlashSessionOptions, pullFlash } from "../http/flashSession";

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
  csrf?: CsrfTokenOptions;
  flash?: FlashSessionOptions;
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
  return createWebLayoutDataResolver(container, options)(request);
}

/** Captures layout configuration for one application. */
function createWebLayoutDataResolver(
  container: ServiceContainerLike,
  options: WebLayoutDataOptions = {},
): (request?: Request) => Promise<Record<string, unknown>> {
  const scoped = {
    ...options,
    csrf: options.csrf ? { ...options.csrf } : undefined,
    flash: options.flash ? { ...options.flash } : undefined,
    extra: typeof options.extra === "function" ? options.extra : { ...options.extra },
  };
  return (request) => loadWebLayoutData(container, request, scoped);
}

async function loadWebLayoutData(
  container: ServiceContainerLike,
  request: Request | undefined,
  resolved: WebLayoutDataOptions,
): Promise<Record<string, unknown>> {
  const meta = currentRequestMeta();
  const established = request !== undefined && meta.request === request;
  const csrfToken = request
    ? resolved.csrf
      ? resolveCsrfTokenForRequest(request, resolved.csrf)
      : established
        ? (meta.csrfToken ?? "")
        : ""
    : "";
  const flash = request
    ? established && meta.flash !== undefined
      ? meta.flash
      : resolved.flash
        ? pullFlash(request, resolved.flash)
        : null
    : null;
  const userKey = layoutUserKey(resolved);
  const loadUser = resolved.loadUser ?? defaultLoadLayoutUser;
  const user = await loadUser(container, request);
  const extra =
    typeof resolved.extra === "function" ? await resolved.extra(user) : (resolved.extra ?? {});

  return {
    [userKey]: user,
    csrfToken,
    flash,
    cspNonce: established ? (meta.cspNonce ?? "") : "",
    ...extra,
  };
}

export type { WebLayoutAuthUser, WebLayoutData, WebLayoutDataOptions, WebLayoutUserKey };
export { createWebLayoutDataResolver, resolveWebLayoutData };
