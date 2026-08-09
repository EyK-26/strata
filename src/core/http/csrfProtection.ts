const DEFAULT_CSRF_TTL_MS = 60 * 60 * 1000;

interface CsrfProtectionOptions {
  expiresIn?: number;
  maxAge?: number;
}

function createCsrfProtection(secret: string, options: CsrfProtectionOptions = {}) {
  const expiresIn = options.expiresIn ?? DEFAULT_CSRF_TTL_MS;
  const maxAge = options.maxAge ?? expiresIn;

  return {
    generate(_sessionKey?: string): string {
      return Bun.CSRF.generate(secret, { expiresIn });
    },

    verify(token: string | undefined, _sessionKey?: string): boolean {
      if (!token) {
        return false;
      }

      return Bun.CSRF.verify(token, { secret, maxAge });
    },

    secret,
  };
}

export type { CsrfProtectionOptions };
export { createCsrfProtection, DEFAULT_CSRF_TTL_MS };
