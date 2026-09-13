import { CORE_AUTH_TOKEN } from "@getstrata/bootstrap/config";
import type { AuthUser } from "@getstrata/core/auth/authContext";
import { currentAuthUser } from "@getstrata/core/auth/authContext";
import type { ServiceProvider } from "@getstrata/core/contracts/di";
import { envFlagEnabled } from "@getstrata/core/runtime/appEnv";

class StarterAuthManager {
  async resolveWithSource(request?: Request) {
    const user = await this.resolve(request);
    return { user, credentialSource: user ? ("guest" as const) : null };
  }

  async resolve(request?: Request): Promise<AuthUser | null> {
    if (!envFlagEnabled(process.env.AUTH_DEV_HEADERS)) {
      return request ? null : currentAuthUser();
    }
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
