import type { ServiceProvider } from "../contracts";
import {
  AUTH_DEV_HEADERS_CONFIG_KEY,
  CORE_AUTH_TOKEN,
} from "../config";
import {
  AuthManager,
  CompositeGuard,
  DatabaseTokenGuard,
  GuestGuard,
  type AuthGuard,
} from "../../core/auth/guard";

function resolveAllowDevHeaders(): boolean {
  const configured = process.env.AUTH_DEV_HEADERS;

  if (configured === undefined) {
    return true;
  }

  return configured !== "false" && configured !== "0";
}

const authProvider: ServiceProvider = {
  name: "core.auth",
  register({ container, config }) {
    const allowDevHeaders = resolveAllowDevHeaders();
    config.set(AUTH_DEV_HEADERS_CONFIG_KEY, allowDevHeaders);

    const guards: AuthGuard[] = [new DatabaseTokenGuard(container)];

    if (allowDevHeaders) {
      guards.push(new GuestGuard());
    }

    container.set(CORE_AUTH_TOKEN, new AuthManager(new CompositeGuard(guards)));
  },
};

export default authProvider;
