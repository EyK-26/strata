const BASE_URL = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const API_PREFIX = process.env.API_PREFIX ?? "/api/v1";
const ADMIN_TOKEN = process.env.ADMIN_API_TOKEN ?? "workhub-admin-test-token";

async function assertOk(url: string, init?: RequestInit): Promise<void> {
  const response = await fetch(url, init);

  if (!response.ok) {
    throw new Error(`Smoke check failed: ${url} returned ${response.status}`);
  }
}

await assertOk(`${BASE_URL}/health`);
await assertOk(`${BASE_URL}/ready`);
await assertOk(`${BASE_URL}/metrics`);
await assertOk(`${BASE_URL}${API_PREFIX}/auth/me`, {
  headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
});
await assertOk(`${BASE_URL}${API_PREFIX}/organizations`);

console.log(`Smoke tests passed against ${BASE_URL}`);
