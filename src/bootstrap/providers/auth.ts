import { BasicAuthGuard } from "@getstrata/core/auth/basicAuthGuard";
import {
  type AuthGuard,
  AuthManager,
  CompositeGuard,
  DatabaseTokenGuard,
  GuestGuard,
} from "@getstrata/core/auth/guard";
import { JwtGuard } from "@getstrata/core/auth/jwtGuard";
import { SessionGuard } from "@getstrata/core/auth/sessionGuard";
import { authConfig } from "../../config/auth";
import { CORE_AUTH_TOKEN } from "../config";
import type { ServiceProvider } from "../contracts";

const authProvider: ServiceProvider = {
  name: "core.auth",
  register({ container, config }) {
    config.set("auth.allowDevHeaders", authConfig.allowDevHeaders);

    const apiGuard = new DatabaseTokenGuard(container);
    const sessionGuard = new SessionGuard(container);
    const jwtGuard = new JwtGuard();
    const basicGuard = new BasicAuthGuard(container);
    const guards: AuthGuard[] = [apiGuard, jwtGuard, basicGuard, sessionGuard];

    if (authConfig.allowDevHeaders) {
      guards.push(new GuestGuard());
    }

    const auth = new AuthManager(new CompositeGuard(guards));
    auth.registerGuard("api", apiGuard);
    auth.registerGuard("access_token", apiGuard);
    auth.registerGuard("jwt", jwtGuard);
    auth.registerGuard("basic", basicGuard);
    auth.registerGuard("web", sessionGuard);
    auth.registerGuard("session", sessionGuard);

    container.set(CORE_AUTH_TOKEN, auth);
  },
};

export default authProvider;
