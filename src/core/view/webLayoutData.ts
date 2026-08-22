import { currentAuthUser } from "@getstrata/core/auth/authContext";
import { currentRequestMeta } from "@getstrata/core/http/requestMetaContext";
import type { AuthUserDirectory } from "../contracts/authUserDirectory";
import type { ServiceContainerLike } from "../contracts/serviceContainer";
import { CORE_TOKEN_SERVICE_TOKEN } from "../contracts/serviceTokens";
import { resolveCsrfTokenForRequest } from "../http/csrfToken";
import { pullFlash } from "../http/flashSession";

interface WebLayoutAuthUser {
  id: number;
  email: string;
  role: string;
}

interface WebLayoutData {
  authUser: WebLayoutAuthUser | null;
  csrfToken: string;
  flash: { level: string; message: string } | null;
}

async function resolveWebLayoutData(
  container: ServiceContainerLike,
  request?: Request,
): Promise<Record<string, unknown>> {
  const csrfToken = request ? resolveCsrfTokenForRequest(request) : "";
  const flash = request ? (currentRequestMeta().flash ?? pullFlash(request)) : null;
  const authUser = currentAuthUser();

  if (!authUser) {
    return { authUser: null, csrfToken, flash };
  }

  const userId = Number(authUser.id);

  if (!Number.isInteger(userId) || userId <= 0) {
    return { authUser: null, csrfToken, flash };
  }

  if (!container.has(CORE_TOKEN_SERVICE_TOKEN)) {
    return {
      authUser: {
        id: userId,
        email: "",
        role: authUser.role ?? "member",
      },
      csrfToken,
      flash,
    };
  }

  const tokenService = container.resolve<AuthUserDirectory>(CORE_TOKEN_SERVICE_TOKEN);

  try {
    const user = await tokenService.findByIdOrThrow(userId);

    return {
      authUser: {
        id: userId,
        email: user.email ?? "",
        role: authUser.role ?? user.role ?? "member",
      },
      csrfToken,
      flash,
    };
  } catch {
    return { authUser: null, csrfToken, flash };
  }
}

export type { WebLayoutAuthUser, WebLayoutData };
export { resolveWebLayoutData };
