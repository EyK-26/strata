/**
 * Dependency installers need host network/trust/cache settings, not application config.
 * Keep this allowlist separate from generated app, build and server environments.
 */
const installerEnvironmentKeys = [
  "PATH",
  "HOME",
  "TMPDIR",
  "USER",
  "SHELL",
  "BUN_TMPDIR",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
  "no_proxy",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "BUN_INSTALL_CACHE_DIR",
  "NPM_CONFIG_CACHE",
  "npm_config_cache",
] as const;

function installerEnvironment(
  source: Readonly<Record<string, string | undefined>> = process.env,
): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const key of installerEnvironmentKeys) {
    const value = source[key];
    if (value !== undefined) environment[key] = value;
  }
  return environment;
}

export { installerEnvironment };
