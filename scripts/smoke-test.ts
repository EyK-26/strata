const BASE_URL = (process.env.BASE_URL ?? process.env.APP_URL ?? "http://localhost:3000").replace(
  /\/$/,
  "",
);

async function assertOk(url: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(url, init);

  if (!response.ok) {
    throw new Error(`Smoke check failed: ${url} returned ${response.status}`);
  }

  return response;
}

await assertOk(`${BASE_URL}/health`);
await assertOk(`${BASE_URL}/ready`);
await assertOk(`${BASE_URL}/metrics`);

const login = await fetch(`${BASE_URL}/login`, { redirect: "manual" });
if (!login.ok) {
  throw new Error(`Smoke check failed: ${BASE_URL}/login returned ${login.status}`);
}

console.log(`Smoke tests passed against ${BASE_URL}`);
