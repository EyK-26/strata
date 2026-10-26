function releaseGitHubRequest(url: string): Promise<Response> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("Release verification requires the workflow's read token.");
  return fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
  });
}

export { releaseGitHubRequest };
