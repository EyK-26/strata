import { envFlagEnabled } from "@getstrata/core/runtime/appEnv";

interface AuthConfig {
  allowDevHeaders: boolean;
  tokenDefaultAbilities: string[];
}

const authConfig: AuthConfig = {
  allowDevHeaders: envFlagEnabled(process.env.AUTH_DEV_HEADERS),
  tokenDefaultAbilities: [],
};

export type { AuthConfig };
export { authConfig };
