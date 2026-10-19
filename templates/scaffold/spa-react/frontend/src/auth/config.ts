export type AuthTransport = "cookie" | "token" | "jwt" | "headers";
// The generator replaces these public capabilities for the chosen auth stack.
export const AUTH_CONFIG: { transport: AuthTransport; mfa: boolean } = {
  transport: "cookie",
  mfa: false,
};
