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

process.env.APP_URL = BASE_URL;
await import("../apps/hiroapp/src/scripts/smoke.ts");

console.log(`Smoke tests passed against ${BASE_URL}`);
