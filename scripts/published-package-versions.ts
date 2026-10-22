type RegistryRequest = (url: string) => Promise<Response>;

async function fetchPublishedVersions(
  name: string,
  request: RegistryRequest = fetch,
): Promise<string[]> {
  try {
    const response = await request(`https://registry.npmjs.org/${name}`);
    if (!response.ok) {
      return [];
    }
    const body = (await response.json()) as { versions?: Record<string, unknown> };
    return Object.keys(body.versions ?? {});
  } catch {
    return [];
  }
}

export { fetchPublishedVersions };
