import type { ServiceContainer } from "../../bootstrap/contracts";
import { tokenServiceToken } from "../../modules/user/provider";
import type TokenService from "../../modules/user/tokenService";
import { currentAuthUser } from "../auth/authContext";
import { resolveCsrfTokenForRequest } from "../http/csrfToken";
import { pullFlash } from "../http/flashSession";
import { currentRequestMeta } from "../http/requestMetaContext";

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
  container: ServiceContainer,
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

  if (!container.has(tokenServiceToken)) {
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

  const tokenService = container.resolve<TokenService>(tokenServiceToken);

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
