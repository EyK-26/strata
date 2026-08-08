import type { ServiceProvider } from "../contracts";
import {
  CORE_AUTH_TOKEN,
  DEFAULT_API_TOKEN,
} from "../config";
import {
  ApiTokenGuard,
  AuthManager,
  GuestGuard,
} from "../../core/auth/guard";

const authProvider: ServiceProvider = {
  name: "core.auth",
  register({ container, config }) {
    const apiToken = process.env.API_TOKEN ?? DEFAULT_API_TOKEN;

    config.set("auth.apiToken", apiToken);

    const guard =
      apiToken.trim() === ""
        ? new GuestGuard()
        : new ApiTokenGuard({
            token: apiToken,
            user: { id: 1, role: "admin" },
          });

    container.set(CORE_AUTH_TOKEN, new AuthManager(guard));
  },
};

export default authProvider;
