interface AuthConfig {
  allowDevHeaders: boolean;
  tokenDefaultAbilities: string[];
}

const authConfig: AuthConfig = {
  allowDevHeaders: (process.env.AUTH_DEV_HEADERS ?? "true") !== "false",
  tokenDefaultAbilities: ["*"],
};

export { authConfig };
export type { AuthConfig };
