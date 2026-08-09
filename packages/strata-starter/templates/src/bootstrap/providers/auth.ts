import { CORE_AUTH_TOKEN } from "@getstrata/bootstrap/config";
import type { AuthUser } from "@getstrata/core/auth/authContext";
import { currentAuthUser } from "@getstrata/core/auth/authContext";
import type { ServiceProvider } from "@getstrata/core/contracts/di";

class StarterAuthManager {
  async resolve(request?: Request): Promise<AuthUser | null> {
    if (request) {
      const userId = request.headers.get("x-authenticated-user-id");
      if (!userId) {
        return null;
      }

      const role = request.headers.get("x-authenticated-user-role");

      return {
        id: userId,
        ...(role ? { role } : {}),
      };
    }

    return currentAuthUser();
  }

  user(request?: Request) {
    return this.resolve(request);
  }

  async check(request: Request) {
    return (await this.user(request)) !== null;
  }
}

const authProvider: ServiceProvider = {
  name: "starter.auth",
  register({ container }) {
    container.set(CORE_AUTH_TOKEN, new StarterAuthManager());
  },
};

export default authProvider;
