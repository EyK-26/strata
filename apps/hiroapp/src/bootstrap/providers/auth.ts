import { CORE_AUTH_TOKEN } from "@getstrata/bootstrap/config";
import { createCookieSessionAuthManager } from "@getstrata/bootstrap/web/session";
import { BasicAuthGuard } from "@getstrata/core/auth/basicAuthGuard";
import { DatabaseTokenGuard } from "@getstrata/core/auth/guard";
import { JwtGuard } from "@getstrata/core/auth/jwtGuard";
import { createTokenAbilityChecker } from "@getstrata/core/auth/tokenAbilityChecker";
import type { ServiceProvider } from "@getstrata/core/contracts/di";
import {
  CORE_ABILITY_CHECKER_TOKEN,
  CORE_AUTH_USER_DIRECTORY_TOKEN,
} from "@getstrata/core/contracts/serviceTokens";
import { starterAuthDirectory } from "../authDirectory.ts";

const authProvider: ServiceProvider = {
  name: "starter.auth",
  register({ container }) {
    container.set(CORE_AUTH_USER_DIRECTORY_TOKEN, starterAuthDirectory);
    const auth = createCookieSessionAuthManager({
      secret: process.env.SESSION_SECRET?.trim() || "dev-session-secret-change-me-please-32ch",
      cookieName: "strata_session",
      mapUser: (user) => ({
        id: user.id,
        role: user.is_admin ? "admin" : "member",
      }),
    });
    const apiGuard = new DatabaseTokenGuard(container);
    auth.registerGuard("api", apiGuard);
    auth.registerGuard("access_token", apiGuard);
    auth.registerGuard("token", apiGuard);
    auth.registerGuard("jwt", new JwtGuard());
    auth.registerGuard("basic", new BasicAuthGuard(container));
    container.set(CORE_ABILITY_CHECKER_TOKEN, createTokenAbilityChecker());
    container.set(CORE_AUTH_TOKEN, auth);
  },
};

export default authProvider;
