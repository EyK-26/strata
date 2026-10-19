import { expect, test } from "bun:test";
import { AuthManager, GuestGuard } from "@getstrata/core/auth/guard";
import { restoreEnvVar } from "../helpers/restoreEnv";

async function withMode(mode: string, callback: () => Promise<void>) {
  const app = process.env.APP_ENV,
    flag = process.env.AUTH_DEV_HEADERS;
  Object.assign(process.env, { APP_ENV: mode, AUTH_DEV_HEADERS: "true" });
  try {
    await callback();
  } finally {
    restoreEnvVar("APP_ENV", app);
    restoreEnvVar("AUTH_DEV_HEADERS", flag);
  }
}
for (const name of ["default", "web", "session", "api", "token", "jwt", "basic"])
  test(`named ${name} GuestGuard retains its actual guest credential source`, () =>
    withMode("local", async () => {
      const auth =
        name === "default"
          ? new AuthManager(new GuestGuard())
          : new AuthManager({ resolve: () => null }).registerGuard(name, new GuestGuard());
      const headers = new Headers({
        "x-authenticated-user-id": "42",
        "x-authenticated-user-role": "member",
      });
      if (["api", "token", "jwt"].includes(name))
        headers.set("authorization", "Bearer explicit-dev-guard");
      if (name === "basic") headers.set("authorization", `Basic ${btoa("member:password")}`);
      const resolved = await auth.resolveWithSource(
        new Request("https://app.example.test/", { headers }),
      );
      expect(resolved.user?.id).toBe("42");
      expect(resolved.credentialSource).toBe("guest");
    }));
for (const [name, scheme, source] of [
  ["web", "", "session"],
  ["api", "Bearer valid-guard-proof", "bearer"],
  ["basic", `Basic ${btoa("member:password")}`, "basic"],
] as const)
  test(`custom persisted ${name} guard retains ${source} source classification`, () =>
    withMode("local", async () => {
      const auth = new AuthManager({ resolve: () => null }).registerGuard(name, {
        resolve: () => ({ id: 7, role: "member" }),
      });
      const resolved = await auth.resolveWithSource(
        new Request("https://app.example.test/", {
          headers: scheme ? { authorization: scheme } : {},
        }),
      );
      expect(resolved).toEqual({ user: { id: 7, role: "member" }, credentialSource: source });
    }));
for (const mode of ["production", "staging"])
  test(`named GuestGuard refuses ${mode} even when dev headers are enabled`, () =>
    withMode(mode, async () => {
      const auth = new AuthManager(new GuestGuard());
      expect(
        await auth.resolveWithSource(
          new Request("https://app.example.test/", {
            headers: { "x-authenticated-user-id": "42" },
          }),
        ),
      ).toEqual({ user: null, credentialSource: null });
    }));
