const BASE_URL = (process.env.BASE_URL ?? process.env.APP_URL ?? "http://localhost:3000").replace(
  /\/$/,
  "",
);

async function assertOk(url: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (process.env.SMOKE_HOST) headers.set("host", process.env.SMOKE_HOST);
  const response = await fetch(url, { ...init, headers });

  if (!response.ok) {
    throw new Error(`Smoke check failed: ${url} returned ${response.status}`);
  }

  return response;
}

await assertOk(`${BASE_URL}/health`);
await assertOk(`${BASE_URL}/ready`);

const metricsToken = process.env.METRICS_TOKEN?.trim();
if (metricsToken) {
  await assertOk(`${BASE_URL}/metrics`, {
    headers: { authorization: `Bearer ${metricsToken}` },
  });
} else if (
  (process.env.APP_ENV ?? "").toLowerCase() !== "production" &&
  (process.env.APP_ENV ?? "").toLowerCase() !== "staging"
) {
  await assertOk(`${BASE_URL}/metrics`);
}

const login = await fetch(`${BASE_URL}/login`, {
  redirect: "manual",
  headers: process.env.SMOKE_HOST ? { host: process.env.SMOKE_HOST } : undefined,
});
if (!login.ok) {
  throw new Error(`Smoke check failed: ${BASE_URL}/login returned ${login.status}`);
}

console.log(`Smoke tests passed against ${BASE_URL}`);
