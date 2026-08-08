import type { ServiceProvider } from "../contracts";
import { CORE_AUTH_TOKEN } from "../config";
import { authConfig } from "../../config/auth";
import {
  AuthManager,
  CompositeGuard,
  DatabaseTokenGuard,
  GuestGuard,
  type AuthGuard,
} from "../../core/auth/guard";

const authProvider: ServiceProvider = {
  name: "core.auth",
  register({ container, config }) {
    config.set("auth.allowDevHeaders", authConfig.allowDevHeaders);

    const guards: AuthGuard[] = [new DatabaseTokenGuard(container)];

    if (authConfig.allowDevHeaders) {
      guards.push(new GuestGuard());
    }

    container.set(CORE_AUTH_TOKEN, new AuthManager(new CompositeGuard(guards)));
  },
};

export default authProvider;
