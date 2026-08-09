const TOKEN_KEY = "strata_api_token";

function readToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

function writeToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export { clearToken, readToken, TOKEN_KEY, writeToken };
