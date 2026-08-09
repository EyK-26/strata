import { CORE_AUTH_TOKEN } from "@getstrata/bootstrap/config";
import { createCookieSessionAuthManager } from "@getstrata/bootstrap/web/session";
import type { ServiceProvider } from "@getstrata/core/contracts/di";
import { CORE_AUTH_USER_DIRECTORY_TOKEN } from "@getstrata/core/contracts/serviceTokens";
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
        ...(user.email_verified_at !== undefined
          ? { emailVerifiedAt: user.email_verified_at }
          : {}),
      }),
    });

    container.set(CORE_AUTH_TOKEN, auth);
  },
};

export default authProvider;
