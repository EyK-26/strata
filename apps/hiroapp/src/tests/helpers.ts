import type { CookieSessionAuthManager } from "@getstrata/bootstrap/web/session";
import { createApp } from "../bootstrap/createApp.ts";
import type { HiroSessionUser } from "../bootstrap/providers/auth.ts";
import { users } from "../modules/users/repository.ts";

export function cookieHeader(setCookies: string[]) {
  return setCookies
    .map((entry) => entry.split(";", 1)[0])
    .filter(Boolean)
    .join("; ");
}

export function csrfFrom(cookies: string[]) {
  const raw = cookies.find((entry) => entry.startsWith("hiroapp_csrf="));
  if (!raw) {
    return "";
  }
  return decodeURIComponent(raw.split("=", 2)[1]?.split(";", 1)[0] ?? "");
}

export function collectCookies(response: Response, previous: string[] = []) {
  const next = [...previous];
  const setCookie = response.headers.getSetCookie?.() ?? [];
  for (const cookie of setCookie) {
    const name = cookie.split("=", 1)[0];
    const index = next.findIndex((entry) => entry.startsWith(`${name}=`));
    if (index >= 0) {
      next[index] = cookie;
    } else {
      next.push(cookie);
    }
  }
  return next;
}

export async function bootHiroapp() {
  const { context, routes } = await createApp();
  const server = Bun.serve({
    port: 0,
    routes,
  });
  return { context, server, baseUrl: server.url.toString().replace(/\/$/, "") };
}

export async function signInCookie(email: string) {
  const user = await users.findByEmail(email);
  if (!user) {
    throw new Error(`Missing seeded user ${email}`);
  }
  const auth = (await import("../http/currentUser.ts")).authManager() as CookieSessionAuthManager;
  const sessionUser: HiroSessionUser = {
    id: user.id,
    name: `${user.first_name} ${user.last_name}`,
    email: user.email,
    first_name: user.first_name,
    last_name: user.last_name,
    role_id: user.role_id,
    is_admin: Number(user.role_id) === 1,
  };
  const { setCookie } = await auth.signIn(sessionUser, {
    userAgent: "HiroAppTest/1.0",
    ipAddress: "127.0.0.1",
  });
  return { user, cookies: [setCookie] };
}

export async function seededUser(email: string) {
  const user = await users.findByEmail(email);
  if (!user) {
    throw new Error(`Missing seeded user ${email}`);
  }
  return user;
}
