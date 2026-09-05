import { isViewsEnabled } from "@getstrata/core/runtime/frontendMode";

/**
 * Smoke: login + role homes + one candidate apply POST.
 * Requires a running server and a seeded database.
 */
const base = process.env.APP_URL?.replace(/\/$/, "") || "http://127.0.0.1:3000";

function cookieHeader(setCookies: string[]) {
  return setCookies
    .map((entry) => entry.split(";", 1)[0])
    .filter(Boolean)
    .join("; ");
}

async function request(path: string, init: RequestInit & { cookies?: string[] } = {}) {
  const headers = new Headers(init.headers);
  if (init.cookies?.length) {
    headers.set("cookie", cookieHeader(init.cookies));
  }
  const response = await fetch(`${base}${path}`, { ...init, headers, redirect: "manual" });
  const nextCookies = [...(init.cookies ?? [])];
  const setCookie = response.headers.getSetCookie?.() ?? [];
  for (const cookie of setCookie) {
    nextCookies.push(cookie);
  }
  return { response, cookies: nextCookies, body: await response.text() };
}

function csrfFrom(cookies: string[]) {
  const raw = cookies.find((entry) => entry.startsWith("hiroapp_csrf="));
  if (!raw) return "";
  return decodeURIComponent(raw.split("=", 2)[1]?.split(";", 1)[0] ?? "");
}

async function login(email: string) {
  const htmx = isViewsEnabled();
  const home = await request(htmx ? "/login" : "/");
  const token = csrfFrom(home.cookies);
  const posted = htmx
    ? await request("/login", {
        method: "POST",
        cookies: home.cookies,
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          accept: "text/html",
        },
        body: new URLSearchParams({ _token: token, email, password: "password" }).toString(),
      })
    : await request("/login", {
        method: "POST",
        cookies: home.cookies,
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          "x-csrf-token": token,
        },
        body: JSON.stringify({ email, password: "password" }),
      });
  if (!(posted.response.ok || posted.response.status === 302)) {
    throw new Error(`login ${email} failed: ${posted.response.status} ${posted.body}`);
  }
  const me = await request("/api/user", {
    cookies: posted.cookies,
    headers: { accept: "application/json", "x-csrf-token": csrfFrom(posted.cookies) },
  });
  if (!me.response.ok) {
    throw new Error(`/api/user after ${email} failed: ${me.response.status} ${me.body}`);
  }
  return { cookies: me.cookies, user: JSON.parse(me.body) };
}

const admin = await login("admin@hiroapp.com");
if (admin.user.role_id !== 1) throw new Error("admin role mismatch");
const candidate = await login("candidate@hiroapp.com");
if (candidate.user.role_id !== 2) throw new Error("candidate role mismatch");
const recruiter = await login("recruiter@hiroapp.com");
if (recruiter.user.role_id !== 3) throw new Error("recruiter role mismatch");

const homes = await Promise.all([
  request("/", { cookies: admin.cookies }),
  request("/", { cookies: candidate.cookies }),
  request("/", { cookies: recruiter.cookies }),
]);
for (const home of homes) {
  if (home.response.status >= 400) {
    throw new Error(`role home failed: ${home.response.status}`);
  }
}

const open = await request("/api/positions?search=", {
  cookies: candidate.cookies,
  headers: { accept: "application/json" },
});
const positions = JSON.parse(open.body) as Array<{
  id: number;
  applications?: Array<{ user_id: number }>;
}>;
const target = positions.find(
  (position) => !(position.applications ?? []).some((app) => app.user_id === candidate.user.id),
);
if (!target) {
  throw new Error("no open position for candidate apply smoke");
}
const apply = await request("/api/applications", {
  method: "POST",
  cookies: candidate.cookies,
  headers: {
    "content-type": "application/json",
    accept: "application/json",
    "x-csrf-token": csrfFrom(candidate.cookies),
  },
  body: JSON.stringify({
    position_id: target.id,
    attachment_text: "Smoke apply",
    attachment_file: "https://example.com/profile",
  }),
});
if (!apply.response.ok) {
  throw new Error(`apply failed: ${apply.response.status} ${apply.body}`);
}

console.log("smoke ok", {
  admin: admin.user.email,
  candidate: candidate.user.email,
  recruiter: recruiter.user.email,
  applied: apply.body,
});
