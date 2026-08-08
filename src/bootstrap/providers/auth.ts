import { authConfig } from "../../config/auth";
import {
  type AuthGuard,
  AuthManager,
  CompositeGuard,
  DatabaseTokenGuard,
  GuestGuard,
} from "../../core/auth/guard";
import { CORE_AUTH_TOKEN } from "../config";
import type { ServiceProvider } from "../contracts";

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
